export declare function verifyTouchIdFuses(appPath: string): Promise<void>
export declare function applyTouchIdFuses(appPath: string): Promise<void>
export declare function compileTouchIdModule(root: string, binary: string, architectures: string[], wallet: boolean): void
export declare function writeSigningEntitlements(root: string, profile: string, appId: string, wallet: boolean, path: string): void
export declare function verifyProbeBundle(appPath: string, config: { appId: string; mac: { entitlements: string; provisioningProfile: string } }, wallet: boolean): Promise<void>
export declare function keychainIdentity(rights: Record<string, unknown>, prefix: string, appId: string, wallet: boolean): { identifier: string; group: string }
