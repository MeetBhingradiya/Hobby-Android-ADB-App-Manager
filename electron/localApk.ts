/**
 * Local APK metadata extraction using apktool.
 *
 * APKs increasingly use resource shortening/obfuscation:
 *   res/mipmap-xxxhdpi/ic_launcher.png → res/-B.png
 * The only reliable way to get icons AND the app name is to run
 * apktool, which decodes both the binary AndroidManifest.xml and
 * the resource table (resources.arsc) back to human-readable form.
 */

import fs from 'fs'
import path from 'path'
import https from 'https'
import os from 'os'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

// ── Types ─────────────────────────────────────────────────────────────

export interface LocalApkInfo {
  filePath: string
  fileName: string
  /** Best-effort from filename; overridden once meta is fetched */
  packageName: string
}

export interface LocalApkMeta {
  packageName: string
  label: string
  iconDataUrl: string | null
  /**
   * True when the APK declares android:sharedUserId="android.uid.system"
   * — means it is a privileged system component and cannot be installed
   * on a standard device without the platform signing key.
   */
  isSystem: boolean
}

export interface GetMetaResult {
  meta: LocalApkMeta | null
  needsJava: boolean
  needsApktool: boolean
  error?: string
}

// ── Cache — in-memory write-through, debounced disk flush ─────────────

interface CacheEntry extends LocalApkMeta {
  fileMtime: number
}

function cachePath(userData: string) {
  return path.join(userData, 'apk-meta-cache.json')
}

let _memCache: Record<string, CacheEntry> | null = null
let _saveTimer: ReturnType<typeof setTimeout> | null = null

function loadCache(userData: string): Record<string, CacheEntry> {
  if (_memCache) return _memCache
  try {
    const p = cachePath(userData)
    _memCache = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {}
  } catch { _memCache = {} }
  return _memCache!
}

function saveCache(userData: string, cache: Record<string, CacheEntry>) {
  _memCache = cache
  if (_saveTimer) clearTimeout(_saveTimer)
  _saveTimer = setTimeout(() => {
    try { fs.writeFileSync(cachePath(userData), JSON.stringify(cache)) } catch {}
  }, 500)
}

// ── GitHub API: resolve latest apktool release ────────────────────────

const FALLBACK_VERSION = '3.0.1'
const FALLBACK_URL = `https://github.com/iBotPeaches/Apktool/releases/download/v${FALLBACK_VERSION}/apktool_${FALLBACK_VERSION}.jar`

interface ApktoolRelease { version: string; downloadUrl: string }

async function fetchLatestRelease(): Promise<ApktoolRelease | null> {
  return new Promise(resolve => {
    https
      .get(
        'https://api.github.com/repos/iBotPeaches/Apktool/releases/latest',
        { headers: { 'User-Agent': 'APKManager/1.0', Accept: 'application/vnd.github+json' } },
        res => {
          const chunks: Buffer[] = []
          res.on('data', (c: Buffer) => chunks.push(c))
          res.on('end', () => {
            try {
              const json = JSON.parse(Buffer.concat(chunks).toString('utf8'))
              const version: string = (json.tag_name as string).replace(/^v/, '')
              const asset = (json.assets as Array<{ name: string; browser_download_url: string }>)
                ?.find(a => a.name.endsWith('.jar'))
              resolve(asset ? { version, downloadUrl: asset.browser_download_url } : null)
            } catch {
              resolve(null)
            }
          })
          res.on('error', () => resolve(null))
        },
      )
      .on('error', () => resolve(null))
  })
}

// ── apktool JAR management ─────────────────────────────────────────────

let _apktoolPath: string | null = null

function findExistingJar(toolsDir: string): string | null {
  if (_apktoolPath && fs.existsSync(_apktoolPath)) return _apktoolPath
  if (!fs.existsSync(toolsDir)) return null
  const jars = fs
    .readdirSync(toolsDir)
    .filter(f => f.startsWith('apktool_') && f.endsWith('.jar'))
    .sort()
    .reverse() // apktool_3.0.1.jar > apktool_2.x.x.jar
  if (jars.length === 0) return null
  _apktoolPath = path.join(toolsDir, jars[0])
  return _apktoolPath
}

export async function checkApktoolReady(
  userData: string,
): Promise<{ javaFound: boolean; apktoolFound: boolean }> {
  const [java, apktool] = await Promise.all([
    findJava(),
    Promise.resolve(findExistingJar(path.join(userData, 'tools'))),
  ])
  return { javaFound: java !== null, apktoolFound: apktool !== null }
}

export async function downloadApktool(
  userData: string,
  onProgress?: (pct: number) => void,
): Promise<{ success: boolean; path: string; error?: string }> {
  const toolsDir = path.join(userData, 'tools')
  fs.mkdirSync(toolsDir, { recursive: true })

  const existing = findExistingJar(toolsDir)
  if (existing) return { success: true, path: existing }

  // Resolve download URL — prefer GitHub API, fall back to hardcoded
  onProgress?.(0)
  let release: ApktoolRelease | null = null
  try { release = await fetchLatestRelease() } catch {}
  const url = release?.downloadUrl ?? FALLBACK_URL
  const version = release?.version ?? FALLBACK_VERSION
  const jarPath = path.join(toolsDir, `apktool_${version}.jar`)

  return new Promise(resolve => {
    const download = (href: string, hops = 0) => {
      if (hops > 8) { resolve({ success: false, path: '', error: 'Too many redirects' }); return }
      https
        .get(href, { headers: { 'User-Agent': 'APKManager/1.0' } }, res => {
          if (res.statusCode === 301 || res.statusCode === 302) {
            download(res.headers.location!, hops + 1)
            return
          }
          const total = parseInt(res.headers['content-length'] ?? '0', 10)
          let received = 0
          const chunks: Buffer[] = []
          res.on('data', (c: Buffer) => {
            chunks.push(c)
            received += c.length
            if (total > 0) onProgress?.(Math.round((received / total) * 100))
          })
          res.on('end', () => {
            try {
              fs.writeFileSync(jarPath, Buffer.concat(chunks))
              _apktoolPath = jarPath
              resolve({ success: true, path: jarPath })
            } catch (err) {
              resolve({ success: false, path: '', error: String(err) })
            }
          })
          res.on('error', err => resolve({ success: false, path: '', error: err.message }))
        })
        .on('error', err => resolve({ success: false, path: '', error: err.message }))
    }
    download(url)
  })
}

// ── Java detection ─────────────────────────────────────────────────────

let _javaPath: string | null = null

async function findJava(): Promise<string | null> {
  if (_javaPath) return _javaPath
  const cmds = process.platform === 'win32' ? ['java.exe', 'java'] : ['java']
  for (const cmd of cmds) {
    try {
      await execFileAsync(cmd, ['-version'], { timeout: 5000 })
      _javaPath = cmd
      return cmd
    } catch {}
  }
  return null
}

// ── Worker pool — CPU & memory-aware concurrency ──────────────────────

/**
 * Compute max parallel apktool jobs from available hardware.
 * Each JVM instance uses ~200-500 MB RAM and 1-2 full CPU cores.
 */
const MAX_CONCURRENT: number = (() => {
  const cpus    = os.cpus().length
  const freeMem = os.freemem()
  const maxByCpu = Math.max(1, Math.floor(cpus / 2))        // half the cores
  const maxByMem = Math.floor(freeMem / (450 * 1024 * 1024)) // 450 MB per JVM
  return Math.max(1, Math.min(maxByCpu, maxByMem, 6))        // absolute cap: 6
})()

let _activeJobs = 0
const _waitQueue: Array<() => void> = []

function drainPool(): void {
  while (_activeJobs < MAX_CONCURRENT && _waitQueue.length > 0) {
    const next = _waitQueue.shift()!
    _activeJobs++
    Promise.resolve().then(next)
  }
}

/** Schedule fn with optional priority boost. Returns a promise for the result. */
function scheduleJob<T>(fn: () => Promise<T>, highPriority: boolean): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => fn().then(resolve, reject).finally(() => { _activeJobs--; drainPool() })
    highPriority ? _waitQueue.unshift(run) : _waitQueue.push(run)
    drainPool()
  })
}

/** In-flight dedup: same cacheKey → same promise, no duplicate jobs */
const _inFlight = new Map<string, Promise<GetMetaResult>>()

function scheduleDeviceJob(
  cacheKey: string,
  fn: () => Promise<GetMetaResult>,
  highPriority: boolean,
): Promise<GetMetaResult> {
  const existing = _inFlight.get(cacheKey)
  if (existing) return existing
  const p = scheduleJob(fn, highPriority)
  _inFlight.set(cacheKey, p)
  p.finally(() => _inFlight.delete(cacheKey))
  return p
}

// ── List APK files ─────────────────────────────────────────────────────

export function listLocalApks(appsDir: string): LocalApkInfo[] {
  if (!fs.existsSync(appsDir)) return []
  return fs
    .readdirSync(appsDir)
    .filter(f => f.endsWith('.apk') || f.endsWith('.apks'))
    .map(f => {
      const base = f.replace(/\.(apks?)$/i, '')
      const packageName = /^[\w.]+$/.test(base) ? base : f
      return { filePath: path.join(appsDir, f), fileName: f, packageName }
    })
}

// ── Full metadata extraction via apktool ──────────────────────────────

/** Parse icon + label + packageName from an apktool-decoded directory */
function parseMeta(tmpDir: string, fallbackName: string): LocalApkMeta | null {
  const manifestPath = path.join(tmpDir, 'AndroidManifest.xml')
  if (!fs.existsSync(manifestPath)) return null
  const manifest = fs.readFileSync(manifestPath, 'utf8')

  const packageName = manifest.match(/<manifest[^>]+package="([^"]+)"/)?.[1] ?? fallbackName

  const appTag = manifest.match(/<application[\s\S]*?>/)?.[0] ?? ''
  let label = appTag.match(/android:label="([^"]+)"/)?.[1] ?? packageName

  const strRef = label.match(/^@string\/(.+)$/)
  if (strRef) {
    const stringsXml = path.join(tmpDir, 'res', 'values', 'strings.xml')
    if (fs.existsSync(stringsXml)) {
      const xml = fs.readFileSync(stringsXml, 'utf8')
      const found = xml.match(new RegExp(`<string name="${strRef[1]}"[^>]*>([^<]+)</string>`))
      if (found) label = found[1]
    }
    if (label.startsWith('@')) label = packageName
  }

  const isSystem =
    /android:sharedUserId="android\.uid\.system"/.test(manifest) ||
    /android:sharedUserId="android\.uid\.phone"/.test(manifest)

  const iconRef = appTag.match(/android:icon="@([^/]+)\/([^"]+)"/)?.[2]
  const resDir = path.join(tmpDir, 'res')
  let iconDataUrl: string | null = null
  if (iconRef && fs.existsSync(resDir))  iconDataUrl = pickBestIcon(resDir, iconRef)
  if (!iconDataUrl && fs.existsSync(resDir)) iconDataUrl = pickBestIcon(resDir, 'ic_launcher')
  if (!iconDataUrl && fs.existsSync(resDir)) iconDataUrl = pickAnyMipmapIcon(resDir)

  return { packageName, label, iconDataUrl, isSystem }
}

/** Run apktool on a local APK file path, return parsed metadata */
async function decodeApk(
  apkFilePath: string,
  userData: string,
  java: string,
  apktool: string,
  fallbackName: string,
): Promise<LocalApkMeta | null> {
  const tmpDir = path.join(userData, `apktool_tmp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`)
  try {
    await execFileAsync(
      java,
      ['-Xmx512m', '-jar', apktool, 'd', apkFilePath, '-o', tmpDir, '--no-src', '-f', '-q'],
      { timeout: 120_000 },
    )
    return parseMeta(tmpDir, fallbackName)
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
  }
}

export async function getLocalApkMeta(
  apkPath: string,
  userData: string,
): Promise<GetMetaResult> {
  // 1. Check disk cache
  const cache = loadCache(userData)
  const mtime = fs.statSync(apkPath).mtimeMs
  const cached = cache[apkPath]
  if (cached && cached.fileMtime === mtime) {
    const { fileMtime: _, ...meta } = cached
    return { meta, needsJava: false, needsApktool: false }
  }

  // 2. Prerequisites
  const java = await findJava()
  if (!java) return { meta: null, needsJava: true, needsApktool: false }

  const apktool = findExistingJar(path.join(userData, 'tools'))
  if (!apktool) return { meta: null, needsJava: false, needsApktool: true }

  // 3. Decode and parse
  try {
    const meta = await decodeApk(apkPath, userData, java, apktool, path.basename(apkPath, '.apk'))
    if (!meta) return { meta: null, needsJava: false, needsApktool: false, error: 'Manifest not found after decode' }

    cache[apkPath] = { ...meta, fileMtime: mtime }
    saveCache(userData, cache)
    return { meta, needsJava: false, needsApktool: false }
  } catch (err) {
    return { meta: null, needsJava: false, needsApktool: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Pull an APK from a connected device, decode it with apktool,
 * and return accurate icon + label + packageName.
 *
 * Requests from visible cards are high-priority and skip ahead of
 * background prefetch jobs.  Results are cached by serial:packageName.
 */
export async function getDeviceApkMeta(
  serial: string,
  packageName: string,
  apkPath: string,
  userData: string,
  adbBin: string,
): Promise<GetMetaResult> {
  // Serve from cache immediately
  const cacheKey = `d:${serial}:${packageName}`
  const cache = loadCache(userData)
  const cached = cache[cacheKey]
  if (cached) {
    const { fileMtime: _, ...meta } = cached
    return { meta, needsJava: false, needsApktool: false }
  }

  const java = await findJava()
  if (!java) return { meta: null, needsJava: true, needsApktool: false }

  const apktool = findExistingJar(path.join(userData, 'tools'))
  if (!apktool) return { meta: null, needsJava: false, needsApktool: true }

  // High-priority: jump ahead of background prefetch jobs
  return scheduleDeviceJob(
    cacheKey,
    () => _pullAndDecode(serial, packageName, apkPath, userData, adbBin, java, apktool, cacheKey),
    true,
  )
}

/**
 * Background-prefetch metadata for all packages in the list.
 * Jobs run at low priority so visible-card requests always go first.
 */
export async function prefetchDeviceMetas(
  serial: string,
  packages: Array<{ packageName: string; apkPath: string }>,
  userData: string,
  adbBin: string,
): Promise<void> {
  const java = await findJava()
  if (!java) return
  const apktool = findExistingJar(path.join(userData, 'tools'))
  if (!apktool) return

  const cache = loadCache(userData)
  for (const pkg of packages) {
    const cacheKey = `d:${serial}:${pkg.packageName}`
    if (cache[cacheKey] || _inFlight.has(cacheKey)) continue
    scheduleDeviceJob(
      cacheKey,
      () => _pullAndDecode(serial, pkg.packageName, pkg.apkPath, userData, adbBin, java, apktool, cacheKey),
      false, // low priority — background
    )
  }
}

/** Internal: execute one pull+decode unit of work */
async function _pullAndDecode(
  serial: string,
  packageName: string,
  apkPath: string,
  userData: string,
  adbBin: string,
  java: string,
  apktool: string,
  cacheKey: string,
): Promise<GetMetaResult> {
  // Re-check cache (a prefetch job may have finished while this was queued)
  const cache = loadCache(userData)
  if (cache[cacheKey]) {
    const { fileMtime: _, ...meta } = cache[cacheKey]
    return { meta, needsJava: false, needsApktool: false }
  }

  const tmpApk = path.join(userData, `pull_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.apk`)
  try {
    await execFileAsync(adbBin, ['-s', serial, 'pull', apkPath, tmpApk], { timeout: 60_000 })
    const meta = await decodeApk(tmpApk, userData, java, apktool, packageName)
    if (!meta) return { meta: null, needsJava: false, needsApktool: false, error: 'Manifest not found' }
    cache[cacheKey] = { ...meta, fileMtime: 0 }
    saveCache(userData, cache)
    return { meta, needsJava: false, needsApktool: false }
  } catch (err) {
    return { meta: null, needsJava: false, needsApktool: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    try { fs.unlinkSync(tmpApk) } catch {}
  }
}

// ── Icon helpers ──────────────────────────────────────────────────────

const DENSITY_ORDER = ['xxxhdpi', 'xxhdpi', 'xhdpi', 'hdpi', 'mdpi', 'ldpi']

function pickBestIcon(resDir: string, iconName: string): string | null {
  const candidates: { density: number; file: string }[] = []

  let subdirs: string[]
  try { subdirs = fs.readdirSync(resDir) } catch { return null }

  for (const sub of subdirs) {
    if (!sub.startsWith('mipmap-') && !sub.startsWith('drawable-')) continue
    const subDir = path.join(resDir, sub)
    const density = DENSITY_ORDER.findIndex(d => sub.includes(d))

    let files: string[]
    try { files = fs.readdirSync(subDir) } catch { continue }

    for (const f of files) {
      if (
        /\.(png|webp)$/i.test(f) &&
        f.toLowerCase().includes(iconName.toLowerCase()) &&
        !f.toLowerCase().includes('_round') &&
        !f.toLowerCase().includes('_adaptive') &&
        !f.toLowerCase().includes('_foreground') &&
        !f.toLowerCase().includes('_background')
      ) {
        candidates.push({ density: density === -1 ? 999 : density, file: path.join(subDir, f) })
      }
    }
  }

  if (candidates.length === 0) return null
  candidates.sort((a, b) => a.density - b.density)

  try {
    const bytes = fs.readFileSync(candidates[0].file)
    const mime = candidates[0].file.endsWith('.webp') ? 'image/webp' : 'image/png'
    return `data:${mime};base64,${bytes.toString('base64')}`
  } catch {
    return null
  }
}

function pickAnyMipmapIcon(resDir: string): string | null {
  for (const d of DENSITY_ORDER) {
    let subdirs: string[]
    try { subdirs = fs.readdirSync(resDir) } catch { return null }

    const match = subdirs.find(s => s.includes('mipmap-') && s.includes(d))
    if (!match) continue
    const subDir = path.join(resDir, match)
    let files: string[]
    try { files = fs.readdirSync(subDir) } catch { continue }

    const img = files.find(f => /\.(png|webp)$/i.test(f))
    if (!img) continue
    try {
      const bytes = fs.readFileSync(path.join(subDir, img))
      const mime = img.endsWith('.webp') ? 'image/webp' : 'image/png'
      return `data:${mime};base64,${bytes.toString('base64')}`
    } catch { continue }
  }
  return null
}
