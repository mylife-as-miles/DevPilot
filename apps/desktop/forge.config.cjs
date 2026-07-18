const path = require('node:path');

module.exports = {
  ...(process.env.DEVPILOT_DESKTOP_OUTPUT_DIR
    ? { outDir: process.env.DEVPILOT_DESKTOP_OUTPUT_DIR }
    : {}),
  packagerConfig: {
    asar: true,
    // Electron is managed at the repository root; make its version explicit so
    // Forge does not try to infer it from this intentionally lean app manifest.
    electronVersion: require('../../node_modules/electron/package.json').version,
    name: 'DevPilot',
    executableName: 'DevPilot',
    appBundleId: 'com.devpilot.desktop',
    // Keep the Windows executable, taskbar, and installer consistently
    // branded even before the renderer has loaded.
    icon: path.resolve(__dirname, 'assets/devpilot.ico'),
    extraResource: [
      path.resolve(__dirname, '../ui/dist'),
      path.resolve(__dirname, '../ui/sources/assets/images/icon.png'),
      path.resolve(__dirname, '../ui/sources/assets/images/devpilot-bot.png'),
      path.resolve(__dirname, './runtime'),
      path.resolve(__dirname, '../../packages/devpilot-runtime/src/acpProcessClient.cjs'),
    ],
  },
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      platforms: ['win32'],
      config: {
        name: 'devpilot',
        setupIcon: path.resolve(__dirname, 'assets/devpilot.ico'),
      },
    },
    { name: '@electron-forge/maker-zip', platforms: ['darwin', 'linux'] },
  ],
};
