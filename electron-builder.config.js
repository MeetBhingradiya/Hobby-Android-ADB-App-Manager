/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'com.apkmanager.app',
  productName: 'APK Manager',
  directories: { output: 'release' },
  files: ['dist/**/*', 'package.json'],
  extraMetadata: { main: 'dist/main.js' },
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'assets/icon.ico',
  },
  mac: {
    target: [{ target: 'dmg', arch: ['x64', 'arm64'] }],
    icon: 'assets/icon.icns',
  },
  linux: {
    target: [{ target: 'AppImage', arch: ['x64'] }],
    icon: 'assets/icon.png',
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
  },
}
