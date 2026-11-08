import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const builderRequire = createRequire(require.resolve('electron-builder'))
const appBuilderRequire = createRequire(builderRequire.resolve('app-builder-lib'))
const { validateConfiguration } = appBuilderRequire('./util/config/config.js')
const { createUpdateInfoTasks } = appBuilderRequire('./publish/updateInfoBuilder.js')
const { Platform } = appBuilderRequire('./core.js')

describe('macOS update compatibility', () => {
  it('emits the kernel minimum through the hook and the installed builder', async () => {
    const config = {
      mac: { minimumSystemVersion: '13.0.0' },
      releaseInfo: { releaseNotes: 'Existing release notes.' },
      publish: { provider: 'generic', url: 'https://updates.example.org' },
    }
    await validateConfiguration(config, { isEnabled: false })
    const beforePack = require('../../build/mac-update-info.cjs')
    const packager = {
      config,
      platform: Platform.MAC,
      platformSpecificBuildOptions: config.mac,
      appInfo: { version: '1.0.0' },
      info: { metadata: {} },
      getResource: async () => null,
    }
    beforePack({ electronPlatformName: 'darwin', packager })
    // No artifact, certificate, network or native packaging is needed to build metadata.
    const tasks = await createUpdateInfoTasks({
      packager,
      file: resolve('out/fixture.zip'),
      target: { outDir: resolve('out') },
      updateInfo: { sha512: 'fixture-checksum' },
    }, [config.publish])
    expect(tasks.length).toBeGreaterThan(0)
    for (const task of tasks) {
      expect(task.info.minimumSystemVersion).toBe('22.0.0')
      expect(task.info.releaseNotes).toBe('Existing release notes.')
      expect(task.info.files[0].sha512).toBe('fixture-checksum')
    }
  })

  it('keeps the kernel requirement out of Windows and Linux metadata', () => {
    const beforePack = require('../../build/mac-update-info.cjs')
    const options = { releaseInfo: { releaseNotes: 'Platform notes.' } }
    for (const electronPlatformName of ['win32', 'linux']) {
      beforePack({ electronPlatformName, packager: { platformSpecificBuildOptions: options } })
      expect(options.releaseInfo).toEqual({ releaseNotes: 'Platform notes.' })
    }
  })

  it('requires updating the kernel minimum when packaging requirements change', () => {
    const beforePack = require('../../build/mac-update-info.cjs')
    const packager = { platformSpecificBuildOptions: { minimumSystemVersion: '14.0.0' } }
    expect(() => beforePack({ electronPlatformName: 'darwin', packager })).toThrow(/Darwin minimum/)
  })
})
