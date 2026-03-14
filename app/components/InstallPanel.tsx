'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import type { Device, LocalApkInfo, LocalApkMeta } from '@/types/electron'
import {
  Upload, FolderOpen, CheckCircle, XCircle, Loader2, X,
  Package, AlertTriangle, Download, ShieldAlert, RefreshCw,
} from 'lucide-react'

// ── Queue types (same as InstallZone) ────────────────────────────────

interface QueueItem {
  path: string
  name: string
  status: 'pending' | 'installing' | 'done' | 'error'
  error?: string
}

// ── Local APK chip (compact horizontal card) ─────────────────────────

interface ChipProps {
  apk: LocalApkInfo
  device: Device
  onNeedsApktool: () => void
}

function LocalApkChip({ apk, device, onNeedsApktool }: ChipProps) {
  const [meta, setMeta] = useState<LocalApkMeta | null>(null)
  const [loading, setLoading] = useState(true)
  const [installState, setInstallState] = useState<'idle' | 'installing' | 'done' | 'error'>('idle')
  const loaded = useRef(false)

  useEffect(() => {
    if (loaded.current) return
    loaded.current = true
    window.adb.getLocalApkMeta(apk.filePath).then(result => {
      if (result.needsApktool) onNeedsApktool()
      setMeta(result.meta)
      setLoading(false)
    })
  }, [apk.filePath, onNeedsApktool])

  const install = async () => {
    if (installState === 'installing') return
    setInstallState('installing')
    const [r] = await window.adb.installApk(device.serial, [apk.filePath])
    if (r.success) {
      setInstallState('done')
      setTimeout(() => setInstallState('idle'), 2000)
    } else {
      setInstallState('error')
      setTimeout(() => setInstallState('idle'), 3000)
    }
  }

  const label = meta?.label ?? apk.packageName
  const icon = meta?.iconDataUrl ?? null

  return (
    <div className="group relative flex w-36 shrink-0 flex-col items-center gap-1.5 rounded-xl border border-border bg-surface p-2 transition hover:border-zinc-600 hover:bg-zinc-800">
      {/* System badge */}
      {meta?.isSystem && (
        <span title="Privileged system APK" className="absolute right-1.5 top-1.5 flex items-center gap-0.5 rounded-full bg-amber-500/20 px-1 py-0.5 text-[8px] font-semibold text-amber-400">
          <ShieldAlert size={7} />SYS
        </span>
      )}

      {/* Icon */}
      <div className="flex h-10 w-10 shrink-0 items-center justify-center">
        {loading ? (
          <div className="h-10 w-10 animate-pulse rounded-xl bg-zinc-700" />
        ) : icon ? (
          <img src={icon} alt={label} className="h-10 w-10 rounded-xl object-contain" draggable={false} />
        ) : (
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-700 text-muted">
            <Package size={20} />
          </div>
        )}
      </div>

      {/* Name */}
      <div className="w-full text-center">
        <p className="w-full truncate text-[11px] font-medium leading-tight text-zinc-200" title={label}>
          {loading ? <span className="inline-block h-2.5 w-20 animate-pulse rounded bg-zinc-700" /> : label}
        </p>
        <p className="mt-0.5 w-full truncate text-[9px] text-muted" title={meta?.packageName ?? apk.packageName}>
          {meta?.packageName ?? apk.packageName}
        </p>
      </div>

      {/* Install button */}
      <button
        onClick={install}
        disabled={loading || installState === 'installing'}
        title={meta?.isSystem ? 'System APK — may need platform key' : `Install ${label}`}
        className={`flex w-full items-center justify-center gap-1 rounded-lg py-1 text-[10px] font-medium transition disabled:opacity-50 ${
          installState === 'done'   ? 'bg-success/20 text-success' :
          installState === 'error'  ? 'bg-danger/20 text-danger' :
          'bg-accent/20 text-accent hover:bg-accent/30'
        }`}
      >
        {installState === 'installing' ? <><Loader2 size={10} className="animate-spin" />Installing…</> :
         installState === 'done'       ? <><CheckCircle size={10} />Installed</> :
         installState === 'error'      ? <><XCircle size={10} />Failed</> :
                                         <><Upload size={10} />Install</>}
      </button>
    </div>
  )
}

// ── Main InstallPanel ─────────────────────────────────────────────────

export function InstallPanel({ device }: { device: Device }) {
  // ── Library state
  const [apks, setApks] = useState<LocalApkInfo[]>([])
  const [libLoading, setLibLoading] = useState(true)
  const [javaFound, setJavaFound] = useState(true)
  const [apktoolFound, setApktoolFound] = useState(true)
  const [downloading, setDownloading] = useState(false)
  const [downloadPct, setDownloadPct] = useState(0)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [metaKey, setMetaKey] = useState(0)
  const reportedMissing = useRef(false)

  // ── Queue state (from InstallZone)
  const [dragging, setDragging] = useState(false)
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [installing, setInstalling] = useState(false)
  const dropRef = useRef<HTMLDivElement>(null)

  // ── Bootstrap
  useEffect(() => {
    window.adb.checkApktool().then(({ javaFound, apktoolFound }) => {
      setJavaFound(javaFound)
      setApktoolFound(apktoolFound)
    })
    const cleanup = window.adb.onApktoolProgress(pct => setDownloadPct(pct))
    return cleanup
  }, [])

  useEffect(() => {
    window.adb.onInstallProgress(({ path, status }) => {
      setQueue(prev =>
        prev.map(item => item.path === path ? { ...item, status: status as QueueItem['status'] } : item)
      )
    })
  }, [])

  const loadLibrary = useCallback(async () => {
    setLibLoading(true)
    setApks(await window.adb.listLocalApks())
    setLibLoading(false)
  }, [])

  useEffect(() => { loadLibrary() }, [loadLibrary])

  const handleNeedsApktool = useCallback(() => {
    if (reportedMissing.current) return
    reportedMissing.current = true
    setApktoolFound(false)
  }, [])

  const handleDownloadApktool = async () => {
    setDownloading(true)
    setDownloadError(null)
    setDownloadPct(0)
    const r = await window.adb.downloadApktool()
    setDownloading(false)
    if (r.success) {
      setApktoolFound(true)
      reportedMissing.current = false
      setMetaKey(k => k + 1)
    } else {
      setDownloadError(r.error ?? 'Download failed')
    }
  }

  // ── Queue helpers
  const addFiles = (paths: string[]) => {
    const valid = paths.filter(p => p.endsWith('.apk') || p.endsWith('.apks'))
    if (!valid.length) return
    setQueue(prev => [
      ...prev,
      ...valid
        .filter(p => !prev.some(q => q.path === p))
        .map(p => ({ path: p, name: p.split(/[/\\]/).pop() ?? p, status: 'pending' as const })),
    ])
  }

  const openPicker = async () => addFiles(await window.adb.openApkFileDialog())

  const installQueue = async () => {
    const pending = queue.filter(q => q.status === 'pending' || q.status === 'error')
    if (!pending.length) return
    setInstalling(true)
    const results = await window.adb.installApk(device.serial, pending.map(p => p.path))
    setQueue(prev =>
      prev.map(item => {
        const r = results.find(x => x.path === item.path)
        return r ? { ...item, status: r.success ? 'done' : 'error', error: r.error } : item
      })
    )
    setInstalling(false)
  }

  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); setDragging(true) }
  const onDragLeave = (e: React.DragEvent) => {
    if (!dropRef.current?.contains(e.relatedTarget as Node)) setDragging(false)
  }
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false)
    addFiles(Array.from(e.dataTransfer.files).map(f => (f as File & { path: string }).path))
  }

  const pendingCount = queue.filter(q => q.status === 'pending' || q.status === 'error').length
  const doneCount    = queue.filter(q => q.status === 'done').length
  const showBanner   = !javaFound || !apktoolFound

  return (
    <div className="flex flex-col border-t border-border bg-panel">

      {/* ── Library strip ─────────────────────────────────────────── */}
      <div className="border-b border-border">
        {/* Strip header */}
        <div className="flex items-center gap-2 px-4 py-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
            Library
          </span>
          {!libLoading && (
            <span className="text-[10px] text-zinc-600">{apks.length} APK{apks.length !== 1 ? 's' : ''}</span>
          )}

          {/* apktool warning */}
          {showBanner && (
            <div className="flex items-center gap-1.5 text-[10px] text-amber-400">
              <AlertTriangle size={11} />
              {!javaFound ? 'Java not found — install JRE for icons & labels' : (
                <>
                  apktool not downloaded —
                  <button
                    onClick={handleDownloadApktool}
                    disabled={downloading}
                    className="ml-1 flex items-center gap-1 rounded-full bg-accent/20 px-2 py-0.5 text-accent transition hover:bg-accent/30 disabled:opacity-60"
                  >
                    {downloading
                      ? <><Loader2 size={9} className="animate-spin" />{downloadPct > 0 ? `${downloadPct}%` : 'downloading…'}</>
                      : <><Download size={9} />Download</>}
                  </button>
                  {downloadError && <span className="text-danger">{downloadError}</span>}
                </>
              )}
            </div>
          )}

          <div className="ml-auto flex items-center gap-1">
            <button onClick={() => window.adb.openLocalApkDir()} title="Open Applications folder"
              className="rounded p-1 text-muted transition hover:text-zinc-300">
              <FolderOpen size={13} />
            </button>
            <button onClick={loadLibrary} disabled={libLoading} title="Refresh library"
              className="rounded p-1 text-muted transition hover:text-zinc-300 disabled:opacity-40">
              <RefreshCw size={13} className={libLoading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* Horizontal scroll of chips */}
        {libLoading ? (
          <div className="flex gap-2 overflow-x-auto px-4 pb-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="flex w-36 shrink-0 flex-col items-center gap-1.5 rounded-xl border border-border bg-surface p-2">
                <div className="h-10 w-10 animate-pulse rounded-xl bg-zinc-700" />
                <div className="h-2.5 w-20 animate-pulse rounded bg-zinc-700" />
                <div className="h-6 w-full animate-pulse rounded-lg bg-zinc-700" />
              </div>
            ))}
          </div>
        ) : apks.length === 0 ? (
          <p className="px-4 pb-3 text-[11px] text-muted">
            No APKs in{' '}
            <button onClick={() => window.adb.openLocalApkDir()} className="text-accent hover:underline">
              Applications/
            </button>{' '}
            — drop files there to see them here.
          </p>
        ) : (
          <div className="flex gap-2 overflow-x-auto px-4 pb-3 scrollbar-thin">
            {apks.map(apk => (
              <LocalApkChip
                key={`${apk.filePath}-${metaKey}`}
                apk={apk}
                device={device}
                onNeedsApktool={handleNeedsApktool}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Install queue (drag-drop) ──────────────────────────────── */}
      <div
        ref={dropRef}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={`transition-colors ${dragging ? 'bg-accent/5' : ''}`}
      >
        {queue.length === 0 ? (
          <div className="flex items-center gap-3 px-4 py-2.5">
            <div className={`flex h-7 w-7 items-center justify-center rounded-lg border-2 border-dashed transition ${
              dragging ? 'border-accent text-accent' : 'border-zinc-700 text-muted'
            }`}>
              <Upload size={13} />
            </div>
            <span className="text-xs text-muted">
              Drop <span className="text-zinc-400">.apk</span> / <span className="text-zinc-400">.apks</span> to install
            </span>
            <button onClick={openPicker}
              className="ml-auto flex items-center gap-1.5 rounded-lg bg-zinc-700/60 px-3 py-1.5 text-xs text-zinc-300 transition hover:bg-zinc-700">
              <FolderOpen size={12} />Browse
            </button>
          </div>
        ) : (
          <div className="px-4 py-2">
            <div className="mb-1.5 max-h-24 space-y-1 overflow-y-auto">
              {queue.map(item => (
                <div key={item.path} className="flex items-center gap-2 rounded-lg px-2 py-1 text-xs">
                  <QueueStatusIcon status={item.status} />
                  <span className="flex-1 truncate text-zinc-300" title={item.name}>{item.name}</span>
                  {item.error && <span className="truncate text-[10px] text-danger" title={item.error}>{item.error.slice(0, 40)}</span>}
                  {item.status !== 'installing' && (
                    <button onClick={() => setQueue(q => q.filter(x => x.path !== item.path))} className="text-muted hover:text-zinc-300">
                      <X size={11} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={openPicker}
                className="flex items-center gap-1.5 rounded-lg bg-zinc-700/60 px-2.5 py-1.5 text-xs text-zinc-300 transition hover:bg-zinc-700">
                <FolderOpen size={11} />Add
              </button>
              {doneCount > 0 && (
                <button onClick={() => setQueue(q => q.filter(x => x.status !== 'done'))}
                  className="text-xs text-muted transition hover:text-zinc-400">
                  Clear done
                </button>
              )}
              <div className="flex-1" />
              {pendingCount > 0 && (
                <button onClick={installQueue} disabled={installing}
                  className="flex items-center gap-2 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition hover:bg-indigo-400 disabled:opacity-60">
                  {installing
                    ? <><Loader2 size={11} className="animate-spin" />Installing…</>
                    : <><Upload size={11} />Install {pendingCount} file{pendingCount > 1 ? 's' : ''}</>}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function QueueStatusIcon({ status }: { status: QueueItem['status'] }) {
  if (status === 'pending')   return <div className="h-3 w-3 shrink-0 rounded-full border border-zinc-600" />
  if (status === 'installing') return <Loader2 size={13} className="shrink-0 animate-spin text-accent" />
  if (status === 'done')      return <CheckCircle size={13} className="shrink-0 text-success" />
  return <XCircle size={13} className="shrink-0 text-danger" />
}
