'use client'

import { useState, useEffect } from 'react'
import { Download, FolderOpen, CheckCircle, AlertCircle, Loader2 } from 'lucide-react'

interface Props {
  onReady: () => void
}

export function AdbSetupDialog({ onReady }: Props) {
  const [step, setStep] = useState<'choose' | 'downloading' | 'error'>('choose')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')

  useEffect(() => {
    const cleanup = window.adb.onDownloadProgress((pct) => setProgress(pct))
    return cleanup
  }, [])

  const handleDownload = async () => {
    setStep('downloading')
    setProgress(0)
    const result = await window.adb.downloadAdb()
    if (result.success) {
      onReady()
    } else {
      setError(result.error || 'Unknown error')
      setStep('error')
    }
  }

  const handleBrowse = async () => {
    const p = await window.adb.browseAdbPath()
    if (!p) return
    await window.adb.setAdbPath(p)
    const check = await window.adb.checkAdb()
    if (check.found) {
      onReady()
    } else {
      setError('The selected file does not appear to be a valid adb binary.')
      setStep('error')
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-surface p-6">
      <div className="w-full max-w-md rounded-xl border border-border bg-panel p-8 shadow-2xl">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-zinc-100">ADB Not Found</h1>
          <p className="mt-1 text-sm text-muted">
            Android Debug Bridge (ADB) is required. Choose how to set it up:
          </p>
        </div>

        {step === 'choose' && (
          <div className="flex flex-col gap-3">
            {/* Download option */}
            <button
              onClick={handleDownload}
              className="flex items-center gap-4 rounded-lg border border-border bg-surface p-4 text-left transition hover:border-accent hover:bg-zinc-800"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                <Download size={20} />
              </div>
              <div>
                <div className="font-medium text-zinc-100">Download Platform Tools</div>
                <div className="mt-0.5 text-xs text-muted">
                  Automatically download the latest ADB from Google
                </div>
              </div>
            </button>

            {/* Browse option */}
            <button
              onClick={handleBrowse}
              className="flex items-center gap-4 rounded-lg border border-border bg-surface p-4 text-left transition hover:border-zinc-500 hover:bg-zinc-800"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-700/50 text-zinc-300">
                <FolderOpen size={20} />
              </div>
              <div>
                <div className="font-medium text-zinc-100">Browse for ADB</div>
                <div className="mt-0.5 text-xs text-muted">
                  Point to an existing adb.exe / adb binary on your system
                </div>
              </div>
            </button>
          </div>
        )}

        {step === 'downloading' && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3 text-zinc-300">
              <Loader2 size={18} className="animate-spin text-accent" />
              <span className="text-sm">Downloading Android Platform Tools…</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-700">
              <div
                className="h-full rounded-full bg-accent transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-right text-xs text-muted">{progress}%</p>
          </div>
        )}

        {step === 'error' && (
          <div className="flex flex-col gap-4">
            <div className="flex items-start gap-3 rounded-lg border border-red-500/20 bg-red-500/10 p-3">
              <AlertCircle size={18} className="mt-0.5 shrink-0 text-danger" />
              <p className="text-sm text-zinc-300">{error}</p>
            </div>
            <button
              onClick={() => { setStep('choose'); setError('') }}
              className="rounded-lg bg-zinc-700 px-4 py-2 text-sm text-zinc-100 transition hover:bg-zinc-600"
            >
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
