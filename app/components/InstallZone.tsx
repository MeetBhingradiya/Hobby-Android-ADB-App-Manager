'use client'

import { useState, useRef, useEffect } from 'react'
import type { Device } from '@/types/electron'
import { Upload, FolderOpen, CheckCircle, XCircle, Loader2, X } from 'lucide-react'

interface QueueItem {
  path: string
  name: string
  status: 'pending' | 'installing' | 'done' | 'error'
  error?: string
}

interface Props {
  device: Device
}

export function InstallZone({ device }: Props) {
  const [dragging, setDragging] = useState(false)
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [installing, setInstalling] = useState(false)
  const dropRef = useRef<HTMLDivElement>(null)

  // Listen to per-file install progress from main process
  useEffect(() => {
    const cleanup = window.adb.onInstallProgress(({ path, status }) => {
      setQueue(prev =>
        prev.map(item =>
          item.path === path ? { ...item, status: status as QueueItem['status'] } : item
        )
      )
    })
    return cleanup
  }, [])

  const addFiles = (paths: string[]) => {
    const apkFiles = paths.filter(p => p.endsWith('.apk') || p.endsWith('.apks'))
    if (apkFiles.length === 0) return
    setQueue(prev => [
      ...prev,
      ...apkFiles
        .filter(p => !prev.some(q => q.path === p))
        .map(p => ({
          path: p,
          name: p.split(/[/\\]/).pop() || p,
          status: 'pending' as const,
        })),
    ])
  }

  const openPicker = async () => {
    const paths = await window.adb.openApkFileDialog()
    addFiles(paths)
  }

  const installAll = async () => {
    const pending = queue.filter(q => q.status === 'pending' || q.status === 'error')
    if (pending.length === 0) return

    setInstalling(true)
    const results = await window.adb.installApk(device.serial, pending.map(p => p.path))

    setQueue(prev =>
      prev.map(item => {
        const result = results.find(r => r.path === item.path)
        if (!result) return item
        return { ...item, status: result.success ? 'done' : 'error', error: result.error }
      })
    )
    setInstalling(false)
  }

  const removeItem = (path: string) => {
    setQueue(prev => prev.filter(q => q.path !== path))
  }

  const clearDone = () => {
    setQueue(prev => prev.filter(q => q.status !== 'done'))
  }

  // Drag & drop handlers
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(true)
  }

  const onDragLeave = (e: React.DragEvent) => {
    if (!dropRef.current?.contains(e.relatedTarget as Node)) setDragging(false)
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const paths = Array.from(e.dataTransfer.files).map(f => (f as File & { path: string }).path)
    addFiles(paths)
  }

  const pendingCount = queue.filter(q => q.status === 'pending' || q.status === 'error').length
  const doneCount = queue.filter(q => q.status === 'done').length

  return (
    <div
      ref={dropRef}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`border-t transition-colors ${
        dragging ? 'border-accent bg-accent/5' : 'border-border bg-panel'
      }`}
    >
      {queue.length === 0 ? (
        /* Empty state — compact drop hint */
        <div className="flex items-center gap-3 px-4 py-3">
          <div className={`flex h-8 w-8 items-center justify-center rounded-lg border-2 border-dashed transition ${
            dragging ? 'border-accent text-accent' : 'border-zinc-700 text-muted'
          }`}>
            <Upload size={14} />
          </div>
          <span className="text-xs text-muted">
            Drop <span className="text-zinc-400">.apk</span> / <span className="text-zinc-400">.apks</span> files here to install
          </span>
          <button
            onClick={openPicker}
            className="ml-auto flex items-center gap-1.5 rounded-lg bg-zinc-700/60 px-3 py-1.5 text-xs text-zinc-300 transition hover:bg-zinc-700"
          >
            <FolderOpen size={13} />
            Browse
          </button>
        </div>
      ) : (
        /* Queue */
        <div className="px-4 py-2">
          {/* Queue items */}
          <div className="mb-2 max-h-28 overflow-y-auto space-y-1">
            {queue.map(item => (
              <div key={item.path} className="flex items-center gap-2 rounded-lg px-2 py-1 text-xs">
                <StatusIcon status={item.status} />
                <span className="flex-1 truncate text-zinc-300" title={item.name}>{item.name}</span>
                {item.error && (
                  <span className="truncate text-[10px] text-danger" title={item.error}>
                    {item.error.slice(0, 40)}
                  </span>
                )}
                {item.status !== 'installing' && (
                  <button
                    onClick={() => removeItem(item.path)}
                    className="text-muted hover:text-zinc-300"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Actions row */}
          <div className="flex items-center gap-2">
            <button
              onClick={openPicker}
              className="flex items-center gap-1.5 rounded-lg bg-zinc-700/60 px-2.5 py-1.5 text-xs text-zinc-300 transition hover:bg-zinc-700"
            >
              <FolderOpen size={12} />
              Add
            </button>

            {doneCount > 0 && (
              <button
                onClick={clearDone}
                className="text-xs text-muted hover:text-zinc-400 transition"
              >
                Clear done
              </button>
            )}

            <div className="flex-1" />

            {pendingCount > 0 && (
              <button
                onClick={installAll}
                disabled={installing}
                className="flex items-center gap-2 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition hover:bg-indigo-400 disabled:opacity-60"
              >
                {installing ? (
                  <><Loader2 size={12} className="animate-spin" /> Installing…</>
                ) : (
                  <><Upload size={12} /> Install {pendingCount} file{pendingCount > 1 ? 's' : ''}</>
                )}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function StatusIcon({ status }: { status: QueueItem['status'] }) {
  if (status === 'pending') return <div className="h-3 w-3 rounded-full border border-zinc-600 shrink-0" />
  if (status === 'installing') return <Loader2 size={13} className="animate-spin text-accent shrink-0" />
  if (status === 'done') return <CheckCircle size={13} className="text-success shrink-0" />
  return <XCircle size={13} className="text-danger shrink-0" />
}
