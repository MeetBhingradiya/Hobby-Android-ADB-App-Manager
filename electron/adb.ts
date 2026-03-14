import { execFile, spawn } from 'child_process'
import { promisify } from 'util'
import * as https from 'https'
import * as fs from 'fs'
import * as net from 'net'
import * as path from 'path'
import * as os from 'os'
import AdmZip from 'adm-zip'
import { app } from 'electron'

const execFileAsync = promisify(execFile)

// ---------- Types (mirrored from types/electron.d.ts for main process use) ----------

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

// ---------- Platform-tools download URLs ----------

const PLATFORM_TOOLS_URLS: Record<string, string> = {
    win32: 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip',
    darwin: 'https://dl.google.com/android/repository/platform-tools-latest-darwin.zip',
    linux: 'https://dl.google.com/android/repository/platform-tools-latest-linux.zip',
}

const ADB_BINARY = os.platform() === 'win32' ? 'adb.exe' : 'adb'

// Persisted custom ADB path (set by user), falls back to resolved path
let _adbPath: string | null = null

// Cache file for the downloaded platform-tools ADB path
function getCacheFilePath(): string {
    return path.join(app.getPath('userData'), 'adb-path.txt')
}

function getBundledAdbDir(): string {
    return path.join(app.getPath('userData'), 'platform-tools')
}

// ---------- ADB path resolution ----------

export async function resolveAdb(): Promise<AdbCheckResult> {
    // 1. Use explicitly set path
    if (_adbPath) {
        try {
            const { stdout } = await execFileAsync(_adbPath, ['version'], { timeout: 5000 })
            const version = stdout.split('\n')[0].trim()
            return { found: true, path: _adbPath, version }
        } catch {
            _adbPath = null
        }
    }

    // 2. Check cached downloaded path
    const cachePath = getCacheFilePath()
    if (fs.existsSync(cachePath)) {
        const cached = fs.readFileSync(cachePath, 'utf8').trim()
        if (fs.existsSync(cached)) {
            try {
                const { stdout } = await execFileAsync(cached, ['version'], { timeout: 5000 })
                const version = stdout.split('\n')[0].trim()
                _adbPath = cached
                return { found: true, path: cached, version }
            } catch { /* ignore */ }
        }
    }

    // 3. Check system PATH
    const lookupCmd = os.platform() === 'win32' ? 'where' : 'which'
    try {
        const { stdout } = await execFileAsync(lookupCmd, ['adb'], { timeout: 5000 })
        const systemPath = stdout.split('\n')[0].trim()
        if (systemPath) {
            try {
                const { stdout: ver } = await execFileAsync(systemPath, ['version'], { timeout: 5000 })
                const version = ver.split('\n')[0].trim()
                _adbPath = systemPath
                return { found: true, path: systemPath, version }
            } catch { /* ignore */ }
        }
    } catch { /* not in PATH */ }

    return { found: false, path: null }
}

export function setAdbPath(newPath: string): void {
    _adbPath = newPath
    fs.writeFileSync(getCacheFilePath(), newPath, 'utf8')
}

// ---------- Platform-tools downloader ----------

export async function downloadPlatformTools(
    onProgress: (pct: number) => void
): Promise<{ success: boolean; path: string; error?: string }> {
    const platform = os.platform()
    const url = PLATFORM_TOOLS_URLS[platform]
    if (!url) {
        return { success: false, path: '', error: `Unsupported platform: ${platform}` }
    }

    const tmpZip = path.join(os.tmpdir(), `platform-tools-${Date.now()}.zip`)
    const destDir = getBundledAdbDir()

    try {
        // Download ZIP
        await downloadFile(url, tmpZip, onProgress)

        // Remove old directory if exists
        if (fs.existsSync(destDir)) {
            fs.rmSync(destDir, { recursive: true, force: true })
        }
        fs.mkdirSync(destDir, { recursive: true })

        // Extract ZIP
        const zip = new AdmZip(tmpZip)
        zip.extractAllTo(destDir, true)

        // The zip contains a 'platform-tools/' folder inside
        const innerDir = path.join(destDir, 'platform-tools')
        const adbBin = path.join(fs.existsSync(innerDir) ? innerDir : destDir, ADB_BINARY)

        if (!fs.existsSync(adbBin)) {
            return { success: false, path: '', error: 'adb binary not found after extraction' }
        }

        // Make executable on Unix
        if (os.platform() !== 'win32') {
            fs.chmodSync(adbBin, '755')
        }

        setAdbPath(adbBin)

        return { success: true, path: adbBin }
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        return { success: false, path: '', error: msg }
    } finally {
        if (fs.existsSync(tmpZip)) fs.unlinkSync(tmpZip)
    }
}

function downloadFile(url: string, dest: string, onProgress: (pct: number) => void): Promise<void> {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest)

        const request = (reqUrl: string) => {
            https.get(reqUrl, (res) => {
                // Follow redirects
                if (res.statusCode === 301 || res.statusCode === 302) {
                    file.close()
                    return request(res.headers.location!)
                }
                if (res.statusCode !== 200) {
                    reject(new Error(`HTTP ${res.statusCode}`))
                    return
                }

                const total = parseInt(res.headers['content-length'] || '0', 10)
                let downloaded = 0

                res.on('data', (chunk: Buffer) => {
                    downloaded += chunk.length
                    if (total > 0) onProgress(Math.round((downloaded / total) * 100))
                })

                res.pipe(file)
                file.on('finish', () => file.close(() => resolve()))
                file.on('error', reject)
            }).on('error', reject)
        }

        request(url)
    })
}

// ---------- Helpers ----------

function getAdbPath(): string {
    if (!_adbPath) throw new Error('ADB not configured. Please set up ADB first.')
    return _adbPath
}

async function adb(serial: string | null, args: string[], timeout = 10000): Promise<string> {
    const adbBin = getAdbPath()
    const fullArgs = serial ? ['-s', serial, ...args] : args
    const { stdout } = await execFileAsync(adbBin, fullArgs, { timeout, encoding: 'utf8' })
    return stdout
}

async function adbBinary(serial: string, args: string[], timeout = 10000): Promise<Buffer> {
    const adbBin = getAdbPath()
    const fullArgs = ['-s', serial, ...args]
    const { stdout } = await execFileAsync(adbBin, fullArgs, { timeout, encoding: 'buffer' })
    return stdout as unknown as Buffer
}

// ---------- Device management ----------

export async function listDevices(): Promise<Device[]> {
    const adbBin = getAdbPath()
    const { stdout } = await execFileAsync(adbBin, ['devices', '-l'], { timeout: 8000, encoding: 'utf8' })

    const lines = stdout.split('\n').slice(1)
    const devices: Device[] = []

    for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('*')) continue

        const parts = trimmed.split(/\s+/)
        if (parts.length < 2) continue

        const serial = parts[0]
        const state = parts[1] as Device['state']

        const model = extractTag(trimmed, 'model:') || extractTag(trimmed, 'usb:') || 'Unknown'
        const product = extractTag(trimmed, 'product:')

        let transport: Device['transport'] = 'usb'
        if (serial.includes(':')) transport = 'tcpip'
        else if (serial.startsWith('emulator')) transport = 'emulator'

        // Try to get Android version for connected devices
        let androidVersion: string | undefined
        if (state === 'device') {
            try {
                const ver = await adb(serial, ['shell', 'getprop', 'ro.build.version.release'], 5000)
                androidVersion = ver.trim()
            } catch { /* ignore */ }
        }

        devices.push({ serial, state, model, transport, product, androidVersion })
    }

    return devices
}

function extractTag(line: string, tag: string): string | undefined {
    const idx = line.indexOf(tag)
    if (idx === -1) return undefined
    return line.slice(idx + tag.length).split(/\s/)[0]
}

export async function connectDevice(address: string): Promise<{ success: boolean; message: string }> {
    try {
        const output = await adb(null, ['connect', address], 10000)
        const success = output.includes('connected') && !output.includes('cannot')
        return { success, message: output.trim() }
    } catch (err: unknown) {
        return { success: false, message: err instanceof Error ? err.message : String(err) }
    }
}

export async function disconnectDevice(serial: string): Promise<void> {
    await adb(null, ['disconnect', serial], 8000)
}

// ---------- Package management ----------

export async function listPackages(serial: string, includeSystem: boolean, userId = 0): Promise<PackageInfo[]> {
    // -f includes APK path, -3 limits to user-installed apps
    const args = includeSystem
        ? ['shell', 'pm', 'list', 'packages', '-f', '--user', String(userId)]
        : ['shell', 'pm', 'list', 'packages', '-f', '-3', '--user', String(userId)]

    const output = await adb(serial, args, 30000)
    const packages: PackageInfo[] = []

    for (const line of output.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('package:')) continue

        // Format: package:/data/app/com.example-xxx/base.apk=com.example
        const withoutPrefix = trimmed.slice('package:'.length)
        const eqIdx = withoutPrefix.lastIndexOf('=')
        if (eqIdx === -1) continue

        const apkPath = withoutPrefix.slice(0, eqIdx)
        const packageName = withoutPrefix.slice(eqIdx + 1)

        const isSystem = apkPath.startsWith('/system/') || apkPath.startsWith('/product/') || apkPath.startsWith('/vendor/')

        packages.push({ packageName, apkPath, isSystem })
    }

    return packages
}

// ---------- Icon extraction (exec-out trick — avoids pulling full APK) ----------

export async function getAppIcon(serial: string, pkg: string, apkPath: string): Promise<string | null> {
    try {
        // Two-pass strategy, mipmap dirs only (drawable dirs contain splash screens, banners, etc.):
        // Pass 1 — files named ic_launcher* in any mipmap-* subdirectory (most apps)
        // Pass 2 — any PNG/WebP in any mipmap-* subdir, largest first (fallback for unusual naming)
        const cmd = [
            'sh', '-c',
            `apk="${apkPath}"; ` +
            `icon=$(unzip -l "$apk" 2>/dev/null | ` +
            `grep -E 'res/mipmap-[^/]+/[^/]*ic_launcher[^/]*\\.(png|webp)$' | ` +
            `grep -Ev 'foreground|background|monochrome|adaptive' | ` +
            `sort -k4 -rn | head -1 | awk '{print $NF}'); ` +
            `[ -z "$icon" ] && icon=$(unzip -l "$apk" 2>/dev/null | ` +
            `grep -E 'res/mipmap-[^/]+/[^/]+\\.(png|webp)$' | ` +
            `grep -Ev 'foreground|background|monochrome|adaptive' | ` +
            `sort -k4 -rn | head -1 | awk '{print $NF}'); ` +
            `[ -n "$icon" ] && unzip -p "$apk" "$icon" 2>/dev/null || true`
        ]

        const buf = await adbBinary(serial, ['exec-out', ...cmd], 15000)
        return bufToDataUrl(buf)
    } catch {
        return null
    }
}

function bufToDataUrl(buf: Buffer): string | null {
    if (buf.length < 12) return null
    // PNG: \x89PNG
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
        return `data:image/png;base64,${buf.toString('base64')}`
    }
    // WebP: RIFF????WEBP
    if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
        buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) {
        return `data:image/webp;base64,${buf.toString('base64')}`
    }
    return null
}

// ---------- App label ----------

export async function getAppLabel(serial: string, pkg: string): Promise<string> {
    try {
        const output = await adb(serial, ['shell', 'dumpsys', 'package', pkg], 15000)
        const match = output.match(/applicationLabel=(.+)/)
        if (match) {
            const label = match[1].trim()
            if (label && label !== 'null') return label
        }
    } catch { /* fall through */ }
    return pkg
}

// ---------- APK install ----------

// Session-based install via device pm: sets installer to com.android.vending so
// Android treats the app as "from Play Store" and skips the sideload warning/block.
async function installViaSession(serial: string, apkFiles: string[]): Promise<string> {
    const createOut = await adb(serial, [
        'shell', 'pm', 'install-create', '-r', '-t', '-g',
        '--installer-package', 'com.android.vending',
    ], 15000)

    const m = createOut.match(/\[(\d+)\]/)
    if (!m) throw new Error(`Failed to create install session: ${createOut.trim()}`)
    const sid = m[1]

    try {
        for (let i = 0; i < apkFiles.length; i++) {
            const local = apkFiles[i]
            const devTmp = `/data/local/tmp/__apkm_${sid}_${i}.apk`
            await adb(serial, ['push', local, devTmp], 120000)
            try {
                await adb(serial, ['shell', 'pm', 'install-write', sid, `split_${i}`, devTmp], 60000)
            } finally {
                await adb(serial, ['shell', 'rm', '-f', devTmp], 5000).catch(() => {})
            }
        }
        return await adb(serial, ['shell', 'pm', 'install-commit', sid], 60000)
    } catch (err) {
        await adb(serial, ['shell', 'pm', 'install-abandon', sid], 5000).catch(() => {})
        throw err
    }
}

export async function installApk(
    serial: string,
    paths: string[],
    onProgress?: (info: { path: string; status: string }) => void
): Promise<InstallResult[]> {
    const results: InstallResult[] = []

    for (const apkPath of paths) {
        onProgress?.({ path: apkPath, status: 'installing' })

        const ext = path.extname(apkPath).toLowerCase()

        try {
            let apkFiles: string[]
            let tmpDir: string | null = null

            if (ext === '.apks') {
                // Extract split-APK bundle into a temp dir
                tmpDir = path.join(os.tmpdir(), `apks-install-${Date.now()}`)
                fs.mkdirSync(tmpDir, { recursive: true })
                const zip = new AdmZip(apkPath)
                zip.extractAllTo(tmpDir, true)
                apkFiles = fs.readdirSync(tmpDir)
                    .filter(f => f.toLowerCase().endsWith('.apk'))
                    .map(f => path.join(tmpDir!, f))
                if (apkFiles.length === 0) throw new Error('No APK files found inside the bundle')
            } else {
                apkFiles = [apkPath]
            }

            let output: string
            try {
                // Primary: session-based install with Play Store as installer
                output = await installViaSession(serial, apkFiles)
            } catch {
                // Fallback: legacy adb install / install-multiple
                if (apkFiles.length > 1) {
                    output = await adb(serial, ['install-multiple', '-r', '-t', ...apkFiles], 120000)
                } else {
                    output = await adb(serial, ['install', '-r', '-t', apkFiles[0]], 120000)
                }
            } finally {
                if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true })
            }

            const success = output.toLowerCase().includes('success')
            const pkgMatch = output.match(/pkg: ([\w.]+)/) || output.match(/package: ([\w.]+)/i)

            results.push({
                path: apkPath,
                packageName: pkgMatch?.[1],
                success,
                error: success ? undefined : output.trim(),
            })

            onProgress?.({ path: apkPath, status: success ? 'done' : 'error' })
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err)
            results.push({ path: apkPath, success: false, error: msg })
            onProgress?.({ path: apkPath, status: 'error' })
        }
    }

    return results
}

// ---------- APK uninstall ----------

export async function uninstallPackage(
    serial: string,
    pkg: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const output = await adb(serial, ['uninstall', pkg], 30000)
        const success = output.includes('Success')
        return { success, error: success ? undefined : output.trim() }
    } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
}

// ---------- Local IP discovery ----------

export interface LocalIP {
    name: string
    ip: string
}

export function getLocalIPs(): LocalIP[] {
    const interfaces = os.networkInterfaces()
    const result: LocalIP[] = []
    for (const [name, addrs] of Object.entries(interfaces)) {
        if (!addrs) continue
        for (const addr of addrs) {
            if (addr.family === 'IPv4' && !addr.internal) {
                result.push({ name, ip: addr.address })
            }
        }
    }
    return result
}

// ---------- Wireless pairing (Android 11+) ----------

export async function pairDevice(
    ip: string,
    pairingPort: string,
    code: string
): Promise<{ success: boolean; message: string }> {
    const target = `${ip}:${pairingPort}`
    try {
        const output = await adb(null, ['pair', target, code], 30000)
        const success = output.toLowerCase().includes('successfully paired')
        return { success, message: output.trim() }
    } catch (err: unknown) {
        return { success: false, message: err instanceof Error ? err.message : String(err) }
    }
}

// ---------- Multi-user support ----------

export interface DeviceUser {
    id: number
    name: string
}

export async function listUsers(serial: string): Promise<DeviceUser[]> {
    try {
        const output = await adb(serial, ['shell', 'pm', 'list', 'users'], 10000)
        const users: DeviceUser[] = []
        for (const line of output.split('\n')) {
            // Format: UserInfo{0:Owner:c13} running  or  UserInfo{10:Secure Folder:1030}
            const match = line.match(/UserInfo\{(\d+):([^:}]+)/)
            if (match) users.push({ id: parseInt(match[1], 10), name: match[2].trim() })
        }
        return users.length > 0 ? users : [{ id: 0, name: 'Owner' }]
    } catch {
        return [{ id: 0, name: 'Owner' }]
    }
}

// ---------- ADB port scanner ----------

export async function scanAdbPort(ip: string): Promise<number | null> {
    // Probe common ADB ports sequentially; return the first open one
    const ports = [5555, 5556, 5557, 5558, 5559, 5560, 5561, 5562, 5563, 5564, 5565]
    for (const port of ports) {
        if (await checkTcpPort(ip, port)) return port
    }
    return null
}

function checkTcpPort(host: string, port: number): Promise<boolean> {
    return new Promise(resolve => {
        const sock = net.createConnection({ host, port })
        sock.setTimeout(800)
        sock.once('connect', () => { sock.destroy(); resolve(true) })
        sock.once('error', () => resolve(false))
        sock.once('timeout', () => { sock.destroy(); resolve(false) })
    })
}

// ---------- APK extraction ----------

export async function getApkPaths(serial: string, pkg: string): Promise<string[]> {
    const output = await adb(serial, ['shell', 'pm', 'path', pkg], 10000)
    const paths: string[] = []
    for (const line of output.split('\n')) {
        const match = line.match(/^package:(.+)/)
        if (match) paths.push(match[1].trim())
    }
    return paths
}

export async function extractApk(
    serial: string,
    pkg: string,
    destPath: string
): Promise<{ success: boolean; savedTo?: string; error?: string }> {
    try {
        const devicePaths = await getApkPaths(serial, pkg)
        if (devicePaths.length === 0) return { success: false, error: 'Could not find APK path on device' }

        if (devicePaths.length === 1) {
            // Single APK: pull directly
            await adb(serial, ['pull', devicePaths[0], destPath], 120000)
            return { success: true, savedTo: destPath }
        }

        // Split APKs: pull all to a temp dir, then zip into an .apks bundle
        const tmpDir = path.join(os.tmpdir(), `apk-extract-${Date.now()}`)
        fs.mkdirSync(tmpDir, { recursive: true })
        try {
            for (const devicePath of devicePaths) {
                const fileName = path.basename(devicePath)
                await adb(serial, ['pull', devicePath, path.join(tmpDir, fileName)], 120000)
            }

            const zip = new AdmZip()
            for (const file of fs.readdirSync(tmpDir)) {
                zip.addLocalFile(path.join(tmpDir, file))
            }
            zip.writeZip(destPath)
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true })
        }

        return { success: true, savedTo: destPath }
    } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
}
