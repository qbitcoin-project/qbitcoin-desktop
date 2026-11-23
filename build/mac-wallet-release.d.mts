interface WalletPackContext {
  electronPlatformName: string
  appOutDir: string
  packager: {
    projectDir: string
    appInfo: { id: string; productFilename: string }
    config: { releaseInfo?: object }
    platformSpecificBuildOptions: { minimumSystemVersion: string; entitlements: string; provisioningProfile: string }
  }
}
export declare function beforePack(context: WalletPackContext): void
export declare function afterPack(context: WalletPackContext): Promise<void>
export declare function afterSign(context: WalletPackContext): Promise<void>
