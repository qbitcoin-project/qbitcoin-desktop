#import <Foundation/Foundation.h>
#import <LocalAuthentication/LocalAuthentication.h>
#import <Security/Security.h>
#import <CommonCrypto/CommonDigest.h>
#include <node_api.h>

// JS calls are confined to the main Electron environment. A worker owns its
// own context until completion, even when main invalidates it during sleep.
namespace {
enum class Action { Create, Read, Verify, SilentRead, Remove };
static LAContext *activeContext;

struct Job {
    napi_async_work work{};
    napi_deferred promise{};
    Action action{};
    NSString *account;
    NSString *expected;
    LAContext *context;
    NSString *kind = @"ok";
    NSString *digest;
#ifdef WALLET_TOUCH_ID
    NSMutableData *secret;
    NSString *enrollment;
#endif
    OSStatus status = errSecSuccess;
    NSInteger authenticationError = 0;
    dispatch_time_t deadline{};
};

napi_value stringValue(napi_env env, NSString *value) {
    napi_value result;
    napi_create_string_utf8(env, value.UTF8String, NAPI_AUTO_LENGTH, &result);
    return result;
}

NSString *argument(napi_env env, napi_value value) {
    char text[512];
    size_t length = 0;
    if (napi_get_value_string_utf8(env, value, nullptr, 0, &length) != napi_ok || length >= sizeof(text))
        return nil;
    if (napi_get_value_string_utf8(env, value, text, sizeof(text), &length) != napi_ok)
        return nil;
    return [[NSString alloc] initWithBytes:text length:length encoding:NSUTF8StringEncoding];
}

NSString *fingerprint(NSData *data) {
    unsigned char digest[CC_SHA256_DIGEST_LENGTH];
    CC_SHA256(data.bytes, (CC_LONG)data.length, digest);
    NSMutableString *result = [NSMutableString stringWithCapacity:sizeof(digest) * 2];
    for (const auto byte : digest) [result appendFormat:@"%02x", byte];
    return result;
}

#ifdef WALLET_TOUCH_ID
NSString *enrollmentIdentifier(LAContext *context) {
    NSData *state;
    if (@available(macOS 15.0, *)) state = context.domainState.biometry.stateHash;
    else state = context.evaluatedPolicyDomainState;
    if (!state.length) return nil;
    NSInteger major = NSProcessInfo.processInfo.operatingSystemVersion.majorVersion;
    return [NSString stringWithFormat:@"%ld:%@", (long)major, fingerprint(state)];
}
#endif

// Own the interactive evaluation so invalidating this request's context
// cancels the dialog. Keychain still enforces the item's ACL on the read.
bool authenticate(Job &job) {
    dispatch_semaphore_t finished = dispatch_semaphore_create(0);
    __block BOOL verified = NO;
    __block NSError *failure = nil;
    [job.context evaluatePolicy:LAPolicyDeviceOwnerAuthenticationWithBiometrics
        localizedReason:job.context.localizedReason reply:^(BOOL success, NSError *error) {
            verified = success;
            failure = error;
            dispatch_semaphore_signal(finished);
        }];
    if (dispatch_semaphore_wait(finished, job.deadline) != 0) {
        [job.context invalidate];
        job.kind = @"cancelled";
        job.authenticationError = LAErrorAppCancel;
        return false;
    }
    if (verified) {
#ifdef WALLET_TOUCH_ID
        job.enrollment = enrollmentIdentifier(job.context);
#endif
        return true;
    }
    job.authenticationError = failure ? failure.code : LAErrorInvalidContext;
    switch (job.authenticationError) {
        case LAErrorAuthenticationFailed: job.kind = @"denied"; break;
        case LAErrorBiometryLockout: job.kind = @"lockout"; break;
#ifdef WALLET_TOUCH_ID
        case LAErrorBiometryNotAvailable:
        case LAErrorBiometryNotEnrolled:
        case LAErrorPasscodeNotSet: job.kind = @"unavailable"; break;
        case LAErrorUserFallback:
            job.kind = job.action == Action::Read ? @"fallback" : @"cancelled";
            break;
#endif
        case LAErrorAppCancel:
        case LAErrorSystemCancel:
#ifndef WALLET_TOUCH_ID
        case LAErrorUserFallback:
#endif
        case LAErrorUserCancel: job.kind = @"cancelled"; break;
        default: job.kind = @"error"; break;
    }
    return false;
}

void perform(napi_env, void *data) {
    @autoreleasepool {
        auto &job = *static_cast<Job *>(data);
#ifdef WALLET_TOUCH_ID
        NSString *service = [NSBundle.mainBundle.bundleIdentifier stringByAppendingString:@".vault-unlock.v1"];
#else
        NSString *service = [NSBundle.mainBundle.bundleIdentifier stringByAppendingString:@".touch-id-prototype"];
#endif
        if (!service) { job.status = errSecParam; return; }
        NSMutableDictionary *query = [@{
            (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
            (__bridge id)kSecAttrService: service,
            (__bridge id)kSecAttrAccount: job.account,
            (__bridge id)kSecUseDataProtectionKeychain: @YES,
            (__bridge id)kSecAttrSynchronizable: @NO,
            (__bridge id)kSecUseAuthenticationContext: job.context
        } mutableCopy];
#ifdef WALLET_TOUCH_ID
        SecTaskRef task = SecTaskCreateFromSelf(nullptr);
        if (!task) { job.status = errSecMissingEntitlement; return; }
        id identifier = CFBridgingRelease(SecTaskCopyValueForEntitlement(task, CFSTR("com.apple.application-identifier"), nullptr));
        CFRelease(task);
        if (![identifier isKindOfClass:NSString.class] || ![identifier length]) { job.status = errSecMissingEntitlement; return; }
        query[(__bridge id)kSecAttrAccessGroup] = [identifier stringByAppendingString:@".vault-unlock"];
#endif
        if (job.action == Action::Remove) {
            job.status = SecItemDelete((__bridge CFDictionaryRef)query);
            if (job.status == errSecItemNotFound) job.status = errSecSuccess;
            return;
        }
        if (job.action == Action::Create) {
#ifdef WALLET_TOUCH_ID
            if (!authenticate(job)) return;
            job.context.interactionNotAllowed = YES;
#endif
            SecAccessControlRef acl = SecAccessControlCreateWithFlags(nullptr,
                kSecAttrAccessibleWhenUnlockedThisDeviceOnly, kSecAccessControlBiometryCurrentSet, nullptr);
            if (!acl) { job.status = errSecParam; return; }
            query[(__bridge id)kSecAttrAccessControl] = CFBridgingRelease(acl);
#ifdef WALLET_TOUCH_ID
            query[(__bridge id)kSecValueData] = job.secret;
            job.status = SecItemAdd((__bridge CFDictionaryRef)query, nullptr);
#else
            NSMutableData *key = [NSMutableData dataWithLength:32];
            job.status = SecRandomCopyBytes(kSecRandomDefault, key.length, static_cast<uint8_t *>(key.mutableBytes));
            if (job.status == errSecSuccess) {
                query[(__bridge id)kSecValueData] = key;
                job.status = SecItemAdd((__bridge CFDictionaryRef)query, nullptr);
                if (job.status == errSecSuccess) job.digest = fingerprint(key);
            }
            [key resetBytesInRange:NSMakeRange(0, key.length)];
#endif
            return;
        }
        if (job.action == Action::Read || job.action == Action::Verify) {
            if (!authenticate(job)) return;
            job.context.interactionNotAllowed = YES;
        }
        query[(__bridge id)kSecReturnData] = @YES;
        query[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;
        CFTypeRef found = nullptr;
        job.status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &found);
        NSData *key = CFBridgingRelease(found);
#ifdef WALLET_TOUCH_ID
        if (job.status == errSecSuccess) {
            if (key.length != 32) job.kind = @"mismatch";
            else if (job.action == Action::Read) job.secret = [key mutableCopy];
        }
#else
        if (job.status == errSecSuccess && (key.length != 32 || ![fingerprint(key) isEqual:job.expected]))
            job.kind = @"mismatch";
        // The Security framework owns the returned immutable bytes. The
        // autorelease pool drains here; no copy of the key crosses into JS.
#endif
    }
}

NSString *availability(LAContext *context) {
    NSError *error = nil;
    BOOL available = [context canEvaluatePolicy:LAPolicyDeviceOwnerAuthenticationWithBiometrics error:&error];
    if (available && context.biometryType == LABiometryTypeTouchID) return @"available";
    if ([error.domain isEqual:LAErrorDomain] && error.code == LAErrorBiometryLockout) return @"lockout";
    if ([error.domain isEqual:LAErrorDomain] && error.code == LAErrorBiometryNotEnrolled) return @"notEnrolled";
    return @"unavailable";
}

NSString *resultKind(Job &job) {
    switch (job.status) {
        case errSecSuccess: return job.kind;
        case errSecUserCanceled: return @"cancelled";
        case errSecItemNotFound: return @"missing";
        case errSecInteractionNotAllowed: return @"interactionRequired";
        case errSecAuthFailed:
#ifdef WALLET_TOUCH_ID
            // For these actions biometrics already succeeded. The item ACL refused the read.
            if (job.action == Action::Read || job.action == Action::Verify) return @"itemUnavailable";
#endif
            return [availability([LAContext new]) isEqual:@"lockout"] ? @"lockout" : @"denied";
        case errSecMissingEntitlement: return @"configuration";
        default: return @"error";
    }
}

void complete(napi_env env, napi_status status, void *data) {
    auto *job = static_cast<Job *>(data);
    if (activeContext == job->context) activeContext = nil;
    [job->context invalidate];
    napi_value result, code;
    napi_create_object(env, &result);
    napi_set_named_property(env, result, "kind", stringValue(env, status == napi_ok ? resultKind(*job) : @"error"));
    napi_create_int32(env, job->authenticationError ? (int32_t)job->authenticationError : job->status, &code);
    napi_set_named_property(env, result, "code", code);
    if (job->authenticationError) napi_set_named_property(env, result, "domain", stringValue(env, @"LAError"));
    if (job->digest) napi_set_named_property(env, result, "digest", stringValue(env, job->digest));
#ifdef WALLET_TOUCH_ID
    if (job->enrollment && status == napi_ok && job->status == errSecSuccess && [job->kind isEqual:@"ok"])
        napi_set_named_property(env, result, "enrollment", stringValue(env, job->enrollment));
    if (status == napi_ok && job->action == Action::Read && job->status == errSecSuccess && job->secret.length == 32) {
        napi_value bytes;
        if (napi_create_buffer_copy(env, 32, job->secret.bytes, nullptr, &bytes) == napi_ok)
            napi_set_named_property(env, result, "key", bytes);
    }
    [job->secret resetBytesInRange:NSMakeRange(0, job->secret.length)];
#endif
    napi_resolve_deferred(env, job->promise, result);
    napi_delete_async_work(env, job->work);
    delete job;
}

napi_value run(napi_env env, napi_callback_info info) {
    size_t argc = 5;
    napi_value args[5];
    napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
    if (argc < 4 || activeContext) {
        napi_throw_error(env, nullptr, "Invalid or overlapping Touch ID request.");
        return nullptr;
    }
    NSString *op = argument(env, args[0]);
    NSString *account = argument(env, args[1]);
    NSString *reason = argument(env, args[3]);
    uint32_t remainingMs = 0;
#ifdef WALLET_TOUCH_ID
    void *bytes = nullptr;
    size_t byteCount = 0;
    if (![[NSUUID alloc] initWithUUIDString:account ?: @""] || !reason.length ||
        ![@[@"create", @"read", @"verify", @"cleanup"] containsObject:op ?: @""] ||
        ([op isEqual:@"create"] && (napi_get_buffer_info(env, args[2], &bytes, &byteCount) != napi_ok || byteCount != 32)) ||
        (![op isEqual:@"cleanup"] && (argc != 5 || napi_get_value_uint32(env, args[4], &remainingMs) != napi_ok ||
          remainingMs == 0 || remainingMs > 30000))) {
        napi_throw_error(env, nullptr, "Invalid vault Keychain operation.");
        return nullptr;
    }
#else
    NSString *digest = argument(env, args[2]);
    if ([op isEqual:@"read"] && (argc != 5 || napi_get_value_uint32(env, args[4], &remainingMs) != napi_ok)) {
        napi_throw_error(env, nullptr, "Missing Touch ID request deadline.");
        return nullptr;
    }
    if (![[NSUUID alloc] initWithUUIDString:account ?: @""] || !digest || !reason.length ||
        ![@[@"create", @"read", @"silent", @"remove", @"cleanup"] containsObject:op ?: @""]) {
        napi_throw_error(env, nullptr, "Invalid Touch ID operation.");
        return nullptr;
    }
#endif
    auto *job = new Job();
#ifdef WALLET_TOUCH_ID
    if (bytes) job->secret = [NSMutableData dataWithBytes:bytes length:byteCount];
#else
    job->expected = digest;
#endif
    job->deadline = dispatch_time(DISPATCH_TIME_NOW, (int64_t)remainingMs * NSEC_PER_MSEC);
    job->account = account;
    job->action = [op isEqual:@"create"] ? Action::Create : [op isEqual:@"read"] ? Action::Read :
        [op isEqual:@"verify"] ? Action::Verify : [op isEqual:@"silent"] ? Action::SilentRead : Action::Remove;
    job->context = [LAContext new];
    job->context.touchIDAuthenticationAllowableReuseDuration = 0;
    job->context.localizedFallbackTitle = @"";
#ifdef WALLET_TOUCH_ID
    if (job->action == Action::Read) job->context.localizedFallbackTitle = @"Use Wallet Password";
#endif
    job->context.localizedReason = reason;
    job->context.interactionNotAllowed = job->action == Action::SilentRead || [op isEqual:@"cleanup"];
    activeContext = job->context;
    napi_value promise;
    napi_create_promise(env, &job->promise, &promise);
    if (napi_create_async_work(env, nullptr, stringValue(env, @"Touch ID prototype"), perform, complete, job, &job->work) != napi_ok ||
        napi_queue_async_work(env, job->work) != napi_ok) {
        activeContext = nil;
        if (job->work) napi_delete_async_work(env, job->work);
#ifdef WALLET_TOUCH_ID
        [job->secret resetBytesInRange:NSMakeRange(0, job->secret.length)];
#endif
        delete job;
        napi_throw_error(env, nullptr, "Could not schedule Keychain access.");
        return nullptr;
    }
    return promise;
}

napi_value cancel(napi_env env, napi_callback_info) {
    [activeContext invalidate];
    napi_value result;
    napi_get_undefined(env, &result);
    return result;
}

napi_value capability(napi_env env, napi_callback_info) {
    LAContext *context = [LAContext new];
    NSString *state = availability(context);
#ifdef WALLET_TOUCH_ID
    napi_value result;
    napi_create_object(env, &result);
    napi_set_named_property(env, result, "availability", stringValue(env, state));
    NSString *enrollment = [state isEqual:@"available"] ? enrollmentIdentifier(context) : nil;
    if (enrollment) napi_set_named_property(env, result, "enrollment", stringValue(env, enrollment));
    return result;
#else
    return stringValue(env, state);
#endif
}

napi_value initialize(napi_env env, napi_value exports) {
    const napi_property_descriptor fields[] = {
        {"run", nullptr, run, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"cancel", nullptr, cancel, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"availability", nullptr, capability, nullptr, nullptr, nullptr, napi_default, nullptr}
    };
    napi_define_properties(env, exports, 3, fields);
    return exports;
}
}
NAPI_MODULE(touch_id_probe, initialize)
