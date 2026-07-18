const path = require('node:path');

const bundledRuntimePath = path.resolve(__dirname, 'runtime');

function isBundledRuntimeSource(filePath) {
  // Electron Packager supplies relative paths while walking the application,
  // but configuration tests and some Forge versions use absolute paths.
  const candidate = String(filePath).replace(/\\/g, '/');
  const runtime = bundledRuntimePath.replace(/\\/g, '/');
  const desktopRelative = path.isAbsolute(filePath)
    ? path.relative(__dirname, filePath).replace(/\\/g, '/')
    : candidate;
  const generatedDesktopArtifact = /(?:^|\/)(?:apps\/desktop\/)?(?:runtime|out(?:-[^/]*)?)(?:\/|$)/;

  return generatedDesktopArtifact.test(desktopRelative)
    || generatedDesktopArtifact.test(candidate)
    || candidate === runtime
    || candidate.startsWith(`${runtime}/`);
}

module.exports = {
  ...(process.env.DEVPILOT_DESKTOP_OUTPUT_DIR
    ? { outDir: process.env.DEVPILOT_DESKTOP_OUTPUT_DIR }
    : {}),
  packagerConfig: {
    asar: true,
    // `runtime` is copied once as an extra resource below.  It—and old package
    // output folders—must not also enter app.asar: doing both can cause Forge
    // to archive an entire embedded Python installation during finalization.
    ignore: isBundledRuntimeSource,
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
      bundledRuntimePath,
      path.resolve(__dirname, '../../packages/devpilot-runtime/src/desktopRuntimeClient.cjs'),
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
