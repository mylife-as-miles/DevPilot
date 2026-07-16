const path = require('node:path');

module.exports = {
  packagerConfig: {
    asar: true,
    name: 'DevPilot',
    executableName: 'DevPilot',
    appBundleId: 'com.devpilot.desktop',
    extraResource: [path.resolve(__dirname, '../ui/dist')],
  },
  makers: [
    { name: '@electron-forge/maker-squirrel', platforms: ['win32'], config: { name: 'devpilot' } },
    { name: '@electron-forge/maker-zip', platforms: ['darwin', 'linux'] },
  ],
};
