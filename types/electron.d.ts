// Shared types for the Electron ↔ Renderer bridge

export interface Device {
  serial: string
  state: 'device' | 'offline' | 'unauthorized' | 'connecting'
  model: string
  transport: 'usb' | 'tcpip' | 'emulator'
  product?: string
  androidVersion?: string
}

export interface PackageInfo {
  packageName: string
  apkPath: string
  isSystem: boolean
}

export interface InstallResult {
  path: string
  packageName?: string
  success: boolean
  error?: string
}

export interface AdbCheckResult {
  found: boolean
  path: string | null
  version?: string
}

export interface LocalIP {
  name: string
  ip: string
}

export interface DeviceUser {
  id: number
  name: string
}

export interface LocalApkInfo {
  filePath: string
  fileName: string
  packageName: string
}

export interface LocalApkMeta {
  packageName: string
  label: string
  iconDataUrl: string | null
  /** True when manifest declares android.uid.system — cannot be sideloaded on standard devices */
  isSystem: boolean
}

export interface GetMetaResult {
  meta: LocalApkMeta | null
  needsJava: boolean
  needsApktool: boolean
  error?: string
}

export interface AdbBridge {
  // ADB binary management
  checkAdb(): Promise<AdbCheckResult>
  downloadAdb(onProgress?: (pct: number) => void): Promise<{ success: boolean; path: string; error?: string }>
  setAdbPath(path: string): Promise<void>
  browseAdbPath(): Promise<string | null>

  // Device management
  listDevices(): Promise<Device[]>
  connectDevice(address: string): Promise<{ success: boolean; message: string }>
  disconnectDevice(serial: string): Promise<void>

  // App management
  listPackages(serial: string, includeSystem: boolean, userId?: number): Promise<PackageInfo[]>
  getAppIcon(serial: string, pkg: string, apkPath: string): Promise<string | null>
  getAppLabel(serial: string, pkg: string): Promise<string>

  // APK operations
  installApk(serial: string, paths: string[]): Promise<InstallResult[]>
  uninstallPackage(serial: string, pkg: string): Promise<{ success: boolean; error?: string }>
  extractApk(serial: string, pkg: string): Promise<{ success: boolean; savedTo?: string; error?: string }>

  // File dialogs
  openApkFileDialog(): Promise<string[]>

  // Network / wireless pairing
  getLocalIPs(): Promise<LocalIP[]>
  pairDevice(ip: string, pairingPort: string, code: string): Promise<{ success: boolean; message: string }>
  listUsers(serial: string): Promise<DeviceUser[]>
  scanAdbPort(ip: string): Promise<number | null>

  // Progress events (call once, callback invoked on progress)
  onDownloadProgress(cb: (pct: number) => void): () => void
  onInstallProgress(cb: (info: { path: string; status: string }) => void): () => void

  // Local APK panel
  listLocalApks(): Promise<LocalApkInfo[]>
  getLocalApkMeta(filePath: string): Promise<GetMetaResult>
  getDeviceApkMeta(serial: string, packageName: string, apkPath: string): Promise<GetMetaResult>
  prefetchDeviceMetas(serial: string, packages: Array<{ packageName: string; apkPath: string }>): Promise<void>
  checkApktool(): Promise<{ javaFound: boolean; apktoolFound: boolean }>
  downloadApktool(): Promise<{ success: boolean; path: string; error?: string }>
  openLocalApkDir(): Promise<void>
  onApktoolProgress(cb: (pct: number) => void): () => void
}

declare global {
  interface Window {
    adb: AdbBridge
  }
}
