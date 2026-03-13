'use client'

import { useState, useRef, useEffect } from 'react'
import { X, Wifi, Scan, Loader2 } from 'lucide-react'

interface Props {
  onClose: () => void
  onConnected: () => void
}

export function ConnectDialog({ onClose, onConnected }: Props) {
  const [address, setAddress] = useState('192.168.1.')
  const [port, setPort] = useState('5555')
  const [status, setStatus] = useState<'idle' | 'connecting' | 'scanning' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const connect = async () => {
    const target = port ? `${address}:${port}` : address
    setStatus('connecting')
    setMessage('')

    const result = await window.adb.connectDevice(target)
    if (result.success) {
      setStatus('success')
      setMessage(result.message)
      onConnected()
      setTimeout(onClose, 1000)
    } else {
      setStatus('error')
      setMessage(result.message)
    }
  }

  const scanPort = async () => {
    const ip = address.trim()
    if (!ip || ip.endsWith('.')) return
    setStatus('scanning')
    setMessage('')
    const found = await window.adb.scanAdbPort(ip)
    if (found !== null) {
      setPort(String(found))
      setStatus('idle')
      setMessage('')
    } else {
      setStatus('error')
      setMessage('No open ADB port found on ' + ip)
    }
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') connect()
    if (e.key === 'Escape') onClose()
  }

  const busy = status === 'connecting' || status === 'scanning'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-sm rounded-xl border border-border bg-panel p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wifi size={18} className="text-accent" />
            <h2 className="font-semibold text-zinc-100">Connect Wireless Device</h2>
          </div>
          <button onClick={onClose} className="text-muted hover:text-zinc-300">
            <X size={18} />
          </button>
        </div>

        <div className="flex gap-2">
          <div className="flex-1">
            <label className="mb-1 block text-xs text-muted">IP Address</label>
            <input
              ref={inputRef}
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              onKeyDown={onKey}
              placeholder="192.168.1.100"
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-accent"
            />
          </div>
          <div className="w-28">
            <label className="mb-1 block text-xs text-muted">Port</label>
            <div className="flex gap-1">
              <input
                type="text"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                onKeyDown={onKey}
                placeholder="5555"
                className="w-full min-w-0 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-accent"
              />
              <button
                onClick={scanPort}
                disabled={busy}
                title="Scan for ADB port"
                className="flex shrink-0 items-center justify-center rounded-lg border border-border bg-surface px-2 py-2 text-muted transition hover:border-accent hover:text-accent disabled:opacity-50"
              >
                {status === 'scanning'
                  ? <Loader2 size={14} className="animate-spin" />
                  : <Scan size={14} />
                }
              </button>
            </div>
          </div>
        </div>

        {status === 'scanning' && (
          <p className="mt-3 text-xs text-zinc-400">Scanning ports 5555–5565…</p>
        )}

        {message && (
          <p className={`mt-3 text-xs ${status === 'success' ? 'text-success' : 'text-danger'}`}>
            {message}
          </p>
        )}

        <div className="mt-4 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border border-border py-2 text-sm text-zinc-300 transition hover:bg-zinc-700"
          >
            Cancel
          </button>
          <button
            onClick={connect}
            disabled={busy}
            className="flex-1 rounded-lg bg-accent py-2 text-sm font-medium text-white transition hover:bg-indigo-400 disabled:opacity-60"
          >
            {status === 'connecting' ? 'Connecting…' : 'Connect'}
          </button>
        </div>
      </div>
    </div>
  )
}
