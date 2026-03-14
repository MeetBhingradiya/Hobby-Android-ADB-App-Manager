'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import type { Device, LocalApkInfo, LocalApkMeta } from '@/types/electron'
import { Upload, Loader2, Package, CheckCircle, XCircle, ShieldAlert } from 'lucide-react'

interface Props {
  apk: LocalApkInfo
  device: Device | null
  /** Notify parent if apktool is missing so the banner shows */
  onNeedsApktool?: () => void
}

type InstallState = 'idle' | 'installing' | 'done' | 'error'

export function LocalApkCard({ apk, device, onNeedsApktool }: Props) {
  const [meta, setMeta] = useState<LocalApkMeta | null>(null)
  const [metaLoading, setMetaLoading] = useState(true)
  const [installState, setInstallState] = useState<InstallState>('idle')
  const [installError, setInstallError] = useState<string | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const observed = useRef(false)

  const loadMeta = useCallback(async () => {
    if (observed.current) return
    observed.current = true
    setMetaLoading(true)

    const result = await window.adb.getLocalApkMeta(apk.filePath)

    if (result.needsApktool) {
      onNeedsApktool?.()
    }

    setMeta(result.meta)
    setMetaLoading(false)
  }, [apk.filePath, onNeedsApktool])

  useEffect(() => {
    const el = cardRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      entries => { if (entries[0].isIntersecting) loadMeta() },
      { rootMargin: '100px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [loadMeta])

  const handleInstall = async () => {
    if (!device || installState === 'installing') return
    setInstallState('installing')
    setInstallError(null)
    const [result] = await window.adb.installApk(device.serial, [apk.filePath])
    if (result.success) {
      setInstallState('done')
      setTimeout(() => setInstallState('idle'), 2000)
    } else {
      setInstallState('error')
      setInstallError(result.error ?? 'Install failed')
      setTimeout(() => setInstallState('idle'), 3000)
    }
  }

  const label = meta?.label ?? apk.packageName
  const icon = meta?.iconDataUrl ?? null

  return (
    <div
      ref={cardRef}
      className="group relative flex flex-col items-center gap-2 rounded-xl border border-border bg-panel p-3 transition hover:border-zinc-600 hover:bg-zinc-800"
    >
      {/* System-app warning badge */}
      {meta?.isSystem && (
        <span
          title="Privileged system app — requires platform signing key to install"
          className="absolute right-2 top-2 flex items-center gap-0.5 rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-amber-400"
        >
          <ShieldAlert size={9} />
          SYS
        </span>
      )}

      {/* Icon */}
      <div className="relative flex h-14 w-14 items-center justify-center">
        {metaLoading ? (
          <div className="h-14 w-14 rounded-xl bg-zinc-700 animate-pulse" />
        ) : icon ? (
          <img src={icon} alt={label} className="h-14 w-14 rounded-xl object-contain" draggable={false} />
        ) : (
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-zinc-700 text-muted">
            <Package size={28} />
          </div>
        )}
      </div>

      {/* Labels */}
      <div className="w-full text-center">
        <p
          className="w-full truncate text-xs font-medium leading-tight text-zinc-200"
          title={label}
        >
          {label}
        </p>
        <p
          className="mt-0.5 w-full truncate text-[10px] text-muted"
          title={meta?.packageName ?? apk.packageName}
        >
          {meta?.packageName ?? apk.packageName}
        </p>
        <p className="mt-0.5 w-full truncate text-[9px] text-zinc-600" title={apk.fileName}>
          {apk.fileName}
        </p>
      </div>

      {/* Install button — on hover, only when device connected */}
      {device && (
        <div className="absolute inset-x-1 bottom-1 hidden group-hover:flex items-center gap-1 rounded-lg bg-zinc-900/90 px-1.5 py-1">
          <button
            onClick={handleInstall}
            disabled={installState === 'installing' || metaLoading}
            title={installError ?? (meta?.isSystem ? 'System APK — may fail on unsigned ROMs' : 'Install to connected device')}
            className={`flex flex-1 items-center justify-center gap-1 rounded py-0.5 text-[10px] transition disabled:opacity-50 ${
              installState === 'error'
                ? 'text-danger'
                : installState === 'done'
                ? 'text-success'
                : 'text-muted hover:bg-zinc-700 hover:text-zinc-200'
            }`}
          >
            {installState === 'installing' ? (
              <><Loader2 size={11} className="animate-spin" /><span>Installing…</span></>
            ) : installState === 'done' ? (
              <><CheckCircle size={11} /><span>Installed</span></>
            ) : installState === 'error' ? (
              <><XCircle size={11} /><span>Failed</span></>
            ) : (
              <><Upload size={11} /><span>Install</span></>
            )}
          </button>
        </div>
      )}
    </div>
  )
}
