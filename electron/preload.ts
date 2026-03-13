import { contextBridge, ipcRenderer } from 'electron'

// Expose the ADB bridge to the renderer with contextIsolation
contextBridge.exposeInMainWorld('adb', {
  // ADB binary management
  checkAdb: () => ipcRenderer.invoke('adb:check'),
  downloadAdb: () => ipcRenderer.invoke('adb:download'),
  setAdbPath: (p: string) => ipcRenderer.invoke('adb:set-path', p),
  browseAdbPath: () => ipcRenderer.invoke('adb:browse-path'),

  // Device management
  listDevices: () => ipcRenderer.invoke('adb:list-devices'),
  connectDevice: (address: string) => ipcRenderer.invoke('adb:connect', address),
  disconnectDevice: (serial: string) => ipcRenderer.invoke('adb:disconnect', serial),

  // App management
  listPackages: (serial: string, includeSystem: boolean, userId = 0) =>
    ipcRenderer.invoke('adb:list-packages', serial, includeSystem, userId),
  getAppIcon: (serial: string, pkg: string, apkPath: string) =>
    ipcRenderer.invoke('adb:get-icon', serial, pkg, apkPath),
  getAppLabel: (serial: string, pkg: string) =>
    ipcRenderer.invoke('adb:get-label', serial, pkg),

  // APK operations
  installApk: (serial: string, paths: string[]) =>
    ipcRenderer.invoke('adb:install', serial, paths),
  uninstallPackage: (serial: string, pkg: string) =>
    ipcRenderer.invoke('adb:uninstall', serial, pkg),
  extractApk: (serial: string, pkg: string) =>
    ipcRenderer.invoke('adb:extract', serial, pkg),

  // File dialogs
  openApkFileDialog: () => ipcRenderer.invoke('dialog:open-apk'),

  // Network / wireless pairing
  getLocalIPs: () => ipcRenderer.invoke('adb:get-local-ips'),
  pairDevice: (ip: string, pairingPort: string, code: string) =>
    ipcRenderer.invoke('adb:pair', ip, pairingPort, code),
  listUsers: (serial: string) => ipcRenderer.invoke('adb:list-users', serial),
  scanAdbPort: (ip: string) => ipcRenderer.invoke('adb:scan-port', ip),

  // Progress event listeners — return cleanup functions
  onDownloadProgress: (cb: (pct: number) => void) => {
    const handler = (_: Electron.IpcRendererEvent, pct: number) => cb(pct)
    ipcRenderer.on('adb:download-progress', handler)
    return () => ipcRenderer.removeListener('adb:download-progress', handler)
  },
  onInstallProgress: (cb: (info: { path: string; status: string }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, info: { path: string; status: string }) => cb(info)
    ipcRenderer.on('adb:install-progress', handler)
    return () => ipcRenderer.removeListener('adb:install-progress', handler)
  },
})
