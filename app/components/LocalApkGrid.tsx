'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { Device, LocalApkInfo } from '@/types/electron'
import { RefreshCw, Search, Package, FolderOpen, Download, Loader2, AlertTriangle } from 'lucide-react'
import { LocalApkCard } from './LocalApkCard'

interface Props {
  device: Device | null
}

export function LocalApkGrid({ device }: Props) {
  const [apks, setApks] = useState<LocalApkInfo[]>([])
  const [filtered, setFiltered] = useState<LocalApkInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')

  // apktool readiness
  const [javaFound, setJavaFound] = useState(true)
  const [apktoolFound, setApktoolFound] = useState(true)
  const [downloading, setDownloading] = useState(false)
  const [downloadPct, setDownloadPct] = useState(0)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  /** incremented after apktool download to force cards to reload meta */
  const [metaKey, setMetaKey] = useState(0)

  // Ref to avoid duplicate onNeedsApktool calls from multiple cards
  const reportedMissingApktool = useRef(false)

  useEffect(() => {
    window.adb.checkApktool().then(({ javaFound, apktoolFound }) => {
      setJavaFound(javaFound)
      setApktoolFound(apktoolFound)
    })
    const cleanup = window.adb.onApktoolProgress(pct => setDownloadPct(pct))
    return cleanup
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    const list = await window.adb.listLocalApks()
    setApks(list)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const q = query.toLowerCase().trim()
    setFiltered(
      !q
        ? apks
        : apks.filter(
            a =>
              a.fileName.toLowerCase().includes(q) ||
              a.packageName.toLowerCase().includes(q),
          ),
    )
  }, [query, apks])

  // Called by any card that discovers apktool is missing
  const handleNeedsApktool = useCallback(() => {
    if (reportedMissingApktool.current) return
    reportedMissingApktool.current = true
    setApktoolFound(false)
  }, [])

  const handleDownloadApktool = async () => {
    setDownloading(true)
    setDownloadError(null)
    setDownloadPct(0)
    const result = await window.adb.downloadApktool()
    setDownloading(false)
    if (result.success) {
      setApktoolFound(true)
      reportedMissingApktool.current = false
      // Bump metaKey so all cards re-observe and re-fetch metadata
      setMetaKey(k => k + 1)
    } else {
      setDownloadError(result.error ?? 'Download failed')
    }
  }

  const showBanner = !javaFound || !apktoolFound

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-3 bg-panel">
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-zinc-200">Local APKs</span>
          {!loading && (
            <span className="ml-2 text-xs text-muted">
              {apks.length} file{apks.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        <div className="relative w-52">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search APKs…"
            className="w-full rounded-lg border border-border bg-surface pl-7 pr-3 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-accent"
          />
        </div>

        <button
          onClick={() => window.adb.openLocalApkDir()}
          title="Open Applications folder"
          className="rounded p-1.5 text-muted transition hover:bg-zinc-700 hover:text-zinc-300"
        >
          <FolderOpen size={14} />
        </button>

        <button
          onClick={load}
          disabled={loading}
          title="Refresh"
          className="rounded p-1.5 text-muted transition hover:bg-zinc-700 hover:text-zinc-300 disabled:opacity-40"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* apktool banner */}
      {showBanner && (
        <div className="flex items-center gap-3 border-b border-border bg-zinc-800/60 px-4 py-2.5 text-xs">
          <AlertTriangle size={14} className="shrink-0 text-amber-400" />
          {!javaFound ? (
            <span className="text-zinc-300">
              <span className="font-medium text-amber-400">Java not found.</span>{' '}
              App name &amp; icon decoding requires Java — install a JRE and restart.
            </span>
          ) : (
            <span className="flex-1 text-zinc-300">
              <span className="font-medium text-amber-400">apktool not downloaded.</span>{' '}
              Icons and app names are decoded from APKs using apktool (v{' '}
              <span className="font-mono">latest via GitHub</span>
              ).
            </span>
          )}

          {javaFound && !apktoolFound && (
            <button
              onClick={handleDownloadApktool}
              disabled={downloading}
              className="ml-auto flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 font-medium text-white transition hover:bg-indigo-400 disabled:opacity-60"
            >
              {downloading ? (
                <>
                  <Loader2 size={12} className="animate-spin" />
                  {downloadPct > 0 ? `${downloadPct}%` : 'Downloading…'}
                </>
              ) : (
                <><Download size={12} />Download apktool</>
              )}
            </button>
          )}

          {downloadError && (
            <span className="ml-2 text-danger">{downloadError}</span>
          )}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-muted">
          <RefreshCw size={16} className="animate-spin" />
          <span className="text-sm">Scanning Applications folder…</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted">
          <Package size={40} className="opacity-20" />
          {apks.length === 0 ? (
            <div className="text-center">
              <p className="text-sm text-zinc-400">No APK files found</p>
              <p className="mt-1 text-xs">
                Put{' '}
                <span className="font-mono text-zinc-300">.apk</span> or{' '}
                <span className="font-mono text-zinc-300">.apks</span> files in the{' '}
                <button
                  onClick={() => window.adb.openLocalApkDir()}
                  className="text-accent hover:underline"
                >
                  Applications folder
                </button>
              </p>
            </div>
          ) : (
            <span className="text-sm">No results for "{query}"</span>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-2 overflow-y-auto p-4">
          {filtered.map(apk => (
            <LocalApkCard
              key={`${apk.filePath}-${metaKey}`}
              apk={apk}
              device={device}
              onNeedsApktool={handleNeedsApktool}
            />
          ))}
        </div>
      )}
    </div>
  )
}
