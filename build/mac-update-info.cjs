// electron-builder accepts this field in generated update info, but its
// releaseInfo configuration schema does not expose it. Set it before packaging.
module.exports = function setMacUpdateMinimum(context) {
  if (context.electronPlatformName !== 'darwin') return
  const options = context.packager.platformSpecificBuildOptions
  if (options.minimumSystemVersion !== '13.0.0') {
    throw new Error('Update the Darwin minimum alongside the macOS packaging requirement.')
  }
  options.releaseInfo = {
    ...context.packager.config.releaseInfo,
    ...options.releaseInfo,
    // electron-updater compares os.release(): macOS 13 uses Darwin 22.
    minimumSystemVersion: '22.0.0',
  }
}
