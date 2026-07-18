const path = require('node:path');

module.exports = {
  packagerConfig: {
    asar: true,
    // Electron is managed at the repository root; make its version explicit so
    // Forge does not try to infer it from this intentionally lean app manifest.
    electronVersion: require('../../node_modules/electron/package.json').version,
    name: 'DevPilot',
    executableName: 'DevPilot',
    appBundleId: 'com.devpilot.desktop',
    extraResource: [
      path.resolve(__dirname, '../ui/dist'),
      path.resolve(__dirname, '../../packages/devpilot-runtime/src/acpProcessClient.cjs'),
    ],
  },
  makers: [
    { name: '@electron-forge/maker-squirrel', platforms: ['win32'], config: { name: 'devpilot' } },
    { name: '@electron-forge/maker-zip', platforms: ['darwin', 'linux'] },
  ],
};
