'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import type { Device, PackageInfo } from '@/types/electron'
import { Download, Trash2, Loader2, Package } from 'lucide-react'

interface Props {
  device: Device
  pkg: PackageInfo
  onUninstalled: () => void
}

export function AppCard({ device, pkg, onUninstalled }: Props) {
  const [icon, setIcon] = useState<string | null>(null)
  const [label, setLabel] = useState<string>(pkg.packageName)
  const [iconLoading, setIconLoading] = useState(true)
  const [extracting, setExtracting] = useState(false)
  const [uninstalling, setUninstalling] = useState(false)
  const [confirmUninstall, setConfirmUninstall] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const observed = useRef(false)

  // Lazy-load icon + label when card enters viewport
  const loadMeta = useCallback(async () => {
    if (observed.current) return
    observed.current = true

    // Load label and icon concurrently
    const [iconResult, labelResult] = await Promise.all([
      window.adb.getAppIcon(device.serial, pkg.packageName, pkg.apkPath),
      window.adb.getAppLabel(device.serial, pkg.packageName),
    ])
    setIcon(iconResult)
    setLabel(labelResult)
    setIconLoading(false)
  }, [device.serial, pkg.packageName, pkg.apkPath])

  useEffect(() => {
    const el = cardRef.current
    if (!el) return

    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) loadMeta() },
      { rootMargin: '100px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [loadMeta])

  const handleExtract = async () => {
    setExtracting(true)
    await window.adb.extractApk(device.serial, pkg.packageName)
    setExtracting(false)
  }

  const handleUninstall = async () => {
    if (!confirmUninstall) { setConfirmUninstall(true); return }
    setUninstalling(true)
    const result = await window.adb.uninstallPackage(device.serial, pkg.packageName)
    setUninstalling(false)
    setConfirmUninstall(false)
    if (result.success) onUninstalled()
  }

  return (
    <div
      ref={cardRef}
      className="group relative flex flex-col items-center gap-2 rounded-xl border border-border bg-panel p-3 transition hover:border-zinc-600 hover:bg-zinc-800"
    >
      {/* Icon */}
      <div className="relative flex h-14 w-14 items-center justify-center">
        {iconLoading ? (
          <div className="h-14 w-14 rounded-xl bg-zinc-700 animate-pulse" />
        ) : icon ? (
          <img
            src={icon}
            alt={label}
            className="h-14 w-14 rounded-xl object-contain"
            draggable={false}
          />
        ) : (
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-zinc-700 text-muted">
            <Package size={28} />
          </div>
        )}
      </div>

      {/* Label */}
      <div className="w-full text-center">
        <p className="w-full truncate text-xs font-medium leading-tight text-zinc-200" title={label}>
          {label}
        </p>
        <p className="mt-0.5 w-full truncate text-[10px] text-muted" title={pkg.packageName}>
          {pkg.packageName}
        </p>
      </div>

      {/* Action buttons — appear on hover */}
      <div className="absolute inset-x-1 bottom-1 hidden group-hover:flex items-center gap-1 rounded-lg bg-zinc-900/90 px-1.5 py-1">
        <button
          onClick={handleExtract}
          disabled={extracting}
          title="Extract APK / APKS"
          className="flex flex-1 items-center justify-center gap-1 rounded py-0.5 text-[10px] text-muted transition hover:bg-zinc-700 hover:text-zinc-200 disabled:opacity-50"
        >
          {extracting ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}
          <span>Extract</span>
        </button>

        {!pkg.isSystem && (
          <button
            onClick={handleUninstall}
            disabled={uninstalling}
            title={confirmUninstall ? 'Tap again to confirm' : 'Uninstall'}
            className={`flex flex-1 items-center justify-center gap-1 rounded py-0.5 text-[10px] transition disabled:opacity-50 ${
              confirmUninstall
                ? 'bg-red-600/30 text-danger'
                : 'text-muted hover:bg-zinc-700 hover:text-danger'
            }`}
          >
            {uninstalling ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
            <span>{confirmUninstall ? 'Sure?' : 'Remove'}</span>
          </button>
        )}
      </div>
    </div>
  )
}
