import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import * as path from 'path'
import * as adb from './adb'

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

let mainWindow: BrowserWindow | null = null

// ---------- Window ----------

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#18181b', // zinc-900
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:3000')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'))
  }

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => { mainWindow = null })
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ---------- IPC: ADB binary management ----------

ipcMain.handle('adb:check', async () => {
  return await adb.resolveAdb()
})

ipcMain.handle('adb:download', async (event) => {
  const result = await adb.downloadPlatformTools((pct) => {
    event.sender.send('adb:download-progress', pct)
  })
  return result
})

ipcMain.handle('adb:set-path', async (_event, newPath: string) => {
  adb.setAdbPath(newPath)
})

ipcMain.handle('adb:browse-path', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: 'Select adb executable',
    properties: ['openFile'],
    filters: [
      { name: 'ADB Binary', extensions: process.platform === 'win32' ? ['exe'] : ['*'] },
    ],
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

// ---------- IPC: Device management ----------

ipcMain.handle('adb:list-devices', async () => {
  return await adb.listDevices()
})

ipcMain.handle('adb:connect', async (_event, address: string) => {
  return await adb.connectDevice(address)
})

ipcMain.handle('adb:disconnect', async (_event, serial: string) => {
  await adb.disconnectDevice(serial)
})

// ---------- IPC: Package management ----------

ipcMain.handle('adb:list-packages', async (_event, serial: string, includeSystem: boolean, userId: number) => {
  return await adb.listPackages(serial, includeSystem, userId ?? 0)
})

ipcMain.handle('adb:get-icon', async (_event, serial: string, pkg: string, apkPath: string) => {
  return await adb.getAppIcon(serial, pkg, apkPath)
})

ipcMain.handle('adb:get-label', async (_event, serial: string, pkg: string) => {
  return await adb.getAppLabel(serial, pkg)
})

// ---------- IPC: APK operations ----------

ipcMain.handle('adb:install', async (event, serial: string, paths: string[]) => {
  return await adb.installApk(serial, paths, (info) => {
    event.sender.send('adb:install-progress', info)
  })
})

ipcMain.handle('adb:uninstall', async (_event, serial: string, pkg: string) => {
  return await adb.uninstallPackage(serial, pkg)
})

ipcMain.handle('adb:extract', async (_event, serial: string, pkg: string) => {
  const devicePaths = await adb.getApkPaths(serial, pkg)
  const isSplit = devicePaths.length > 1

  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow!, {
    title: isSplit ? 'Save Split APK Bundle' : 'Save APK',
    defaultPath: isSplit ? `${pkg}.apks` : `${pkg}.apk`,
    filters: isSplit
      ? [{ name: 'Split APK Bundle', extensions: ['apks'] }]
      : [{ name: 'APK', extensions: ['apk'] }],
  })
  if (canceled || !filePath) return { success: false, error: 'Cancelled' }

  const result = await adb.extractApk(serial, pkg, filePath)
  if (result.success && result.savedTo) {
    shell.showItemInFolder(result.savedTo)
  }
  return result
})

// ---------- IPC: Local IP + wireless pairing ----------

ipcMain.handle('adb:get-local-ips', () => {
  return adb.getLocalIPs()
})

ipcMain.handle('adb:pair', async (_event, ip: string, pairingPort: string, code: string) => {
  return await adb.pairDevice(ip, pairingPort, code)
})

ipcMain.handle('adb:list-users', async (_event, serial: string) => {
  return await adb.listUsers(serial)
})

ipcMain.handle('adb:scan-port', async (_event, ip: string) => {
  return await adb.scanAdbPort(ip)
})

// ---------- IPC: File dialogs ----------

ipcMain.handle('dialog:open-apk', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: 'Select APK file(s)',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Android Package', extensions: ['apk', 'apks'] },
    ],
  })
  return result.canceled ? [] : result.filePaths
})
