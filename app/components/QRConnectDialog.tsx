'use client'

import { useState, useEffect, useRef } from 'react'
import type { LocalIP } from '@/types/electron'
import { X, Wifi, QrCode, SmartphoneNfc, CheckCircle, AlertCircle, Loader2, Copy, Check } from 'lucide-react'

interface Props {
  onClose: () => void
  onConnected: () => void
}

type Tab = 'pair' | 'pcinfo'

export function QRConnectDialog({ onClose, onConnected }: Props) {
  const [tab, setTab] = useState<Tab>('pair')
  const [localIPs, setLocalIPs] = useState<LocalIP[]>([])

  // Pair tab state
  const [pairIP, setPairIP] = useState('')
  const [pairPort, setPairPort] = useState('')
  const [pairCode, setPairCode] = useState(['', '', '', '', '', ''])
  const [debugPort, setDebugPort] = useState('5555')
  const [pairStatus, setPairStatus] = useState<'idle' | 'pairing' | 'connecting' | 'done' | 'error'>('idle')
  const [pairMessage, setPairMessage] = useState('')
  const codeRefs = useRef<Array<HTMLInputElement | null>>([])

  // PC info tab state
  const [selectedIP, setSelectedIP] = useState<LocalIP | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [qrError, setQrError] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    window.adb.getLocalIPs().then(ips => {
      setLocalIPs(ips)
      if (ips.length > 0) {
        setSelectedIP(ips[0])
        setPairIP(ips[0].ip)
      }
    })
  }, [])

  // Generate QR code whenever selected IP changes
  useEffect(() => {
    if (!selectedIP) return
    setQrDataUrl('')
    setQrError(false)
    import('qrcode').then(QRCode => {
      // Encode as "ip:port" — recognized by most ADB WiFi Android apps
      QRCode.toDataURL(`${selectedIP.ip}:5555`, {
        width: 220,
        margin: 2,
        color: { dark: '#1e1e2e', light: '#ffffff' },
        errorCorrectionLevel: 'M',
      }).then(setQrDataUrl).catch(() => setQrError(true))
    }).catch(() => setQrError(true))
  }, [selectedIP])

  // OTP-style code input handlers
  const onCodeChange = (idx: number, val: string) => {
    const digit = val.replace(/\D/g, '').slice(-1)
    const next = [...pairCode]
    next[idx] = digit
    setPairCode(next)
    if (digit && idx < 5) codeRefs.current[idx + 1]?.focus()
  }

  const onCodeKeyDown = (idx: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !pairCode[idx] && idx > 0) {
      codeRefs.current[idx - 1]?.focus()
    }
    if (e.key === 'Enter') handlePair()
  }

  const onCodePaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    if (text.length === 6) {
      setPairCode(text.split(''))
      codeRefs.current[5]?.focus()
    }
  }

  const handlePair = async () => {
    const code = pairCode.join('')
    if (!pairIP || !pairPort || code.length < 6) return

    setPairStatus('pairing')
    setPairMessage('')

    const pairResult = await window.adb.pairDevice(pairIP, pairPort, code)

    if (!pairResult.success) {
      setPairStatus('error')
      setPairMessage(pairResult.message)
      return
    }

    // Auto-connect after pairing
    setPairStatus('connecting')
    const connectResult = await window.adb.connectDevice(`${pairIP}:${debugPort}`)

    if (connectResult.success) {
      setPairStatus('done')
      setPairMessage(`Paired & connected to ${pairIP}:${debugPort}`)
      onConnected()
      setTimeout(onClose, 1500)
    } else {
      // Pairing succeeded, but connect failed — still notify
      setPairStatus('done')
      setPairMessage(`Paired! Connect manually: adb connect ${pairIP}:${debugPort}`)
      onConnected()
    }
  }

  const copyCommand = () => {
    if (!selectedIP) return
    navigator.clipboard.writeText(`adb connect ${selectedIP.ip}:5555`)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const codeComplete = pairCode.every(d => d !== '')

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-md rounded-xl border border-border bg-panel shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <SmartphoneNfc size={18} className="text-accent" />
            <h2 className="font-semibold text-zinc-100">Wireless Connect</h2>
          </div>
          <button onClick={onClose} className="text-muted hover:text-zinc-300 transition">
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border">
          {([['pair', 'Pair (Android 11+)'], ['pcinfo', 'Connect via QR']] as const).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex-1 py-2.5 text-sm transition ${
                tab === id
                  ? 'border-b-2 border-accent font-medium text-zinc-100'
                  : 'text-muted hover:text-zinc-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ── Tab: Pair Device ── */}
        {tab === 'pair' && (
          <div className="p-5">
            {/* Instructions */}
            <div className="mb-4 rounded-lg border border-zinc-700 bg-zinc-800/50 p-3 text-xs text-zinc-400">
              <p className="font-medium text-zinc-300 mb-1">Android 11+ — Wireless Debugging:</p>
              <ol className="list-decimal list-inside space-y-0.5">
                <li>Settings → Developer Options → Wireless Debugging</li>
                <li>Tap <span className="text-zinc-200">"Pair device with pairing code"</span></li>
                <li>Enter the IP, port, and 6-digit code below</li>
              </ol>
            </div>

            {/* IP + Pair Port row */}
            <div className="flex gap-2 mb-3">
              <div className="flex-1">
                <label className="mb-1 block text-xs text-muted">Device IP</label>
                <input
                  value={pairIP}
                  onChange={e => setPairIP(e.target.value)}
                  placeholder="192.168.1.100"
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-accent"
                />
              </div>
              <div className="w-24">
                <label className="mb-1 block text-xs text-muted">Pair Port</label>
                <input
                  value={pairPort}
                  onChange={e => setPairPort(e.target.value)}
                  placeholder="37841"
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-accent"
                />
              </div>
            </div>

            {/* 6-digit OTP code */}
            <div className="mb-3">
              <label className="mb-2 block text-xs text-muted">6-digit Pairing Code</label>
              <div className="flex gap-2" onPaste={onCodePaste}>
                {pairCode.map((digit, i) => (
                  <input
                    key={i}
                    ref={el => { codeRefs.current[i] = el }}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={e => onCodeChange(i, e.target.value)}
                    onKeyDown={e => onCodeKeyDown(i, e)}
                    className={`h-11 w-10 rounded-lg border text-center text-lg font-mono font-bold outline-none transition ${
                      digit
                        ? 'border-accent bg-accent/10 text-zinc-100'
                        : 'border-border bg-surface text-zinc-100 focus:border-accent'
                    }`}
                  />
                ))}
              </div>
            </div>

            {/* Debug port */}
            <div className="mb-4">
              <label className="mb-1 block text-xs text-muted">Debug Port (auto-connect after pairing)</label>
              <input
                value={debugPort}
                onChange={e => setDebugPort(e.target.value)}
                placeholder="5555"
                className="w-32 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-accent"
              />
            </div>

            {/* Status message */}
            {pairMessage && (
              <div className={`mb-3 flex items-start gap-2 rounded-lg border p-2.5 text-xs ${
                pairStatus === 'done'
                  ? 'border-green-500/20 bg-green-500/10 text-success'
                  : 'border-red-500/20 bg-red-500/10 text-danger'
              }`}>
                {pairStatus === 'done' ? <CheckCircle size={14} className="mt-0.5 shrink-0" /> : <AlertCircle size={14} className="mt-0.5 shrink-0" />}
                <span>{pairMessage}</span>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="flex-1 rounded-lg border border-border py-2 text-sm text-zinc-300 transition hover:bg-zinc-700"
              >
                Cancel
              </button>
              <button
                onClick={handlePair}
                disabled={!pairIP || !pairPort || !codeComplete || pairStatus === 'pairing' || pairStatus === 'connecting'}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-accent py-2 text-sm font-medium text-white transition hover:bg-indigo-400 disabled:opacity-50"
              >
                {pairStatus === 'pairing' && <><Loader2 size={14} className="animate-spin" /> Pairing…</>}
                {pairStatus === 'connecting' && <><Loader2 size={14} className="animate-spin" /> Connecting…</>}
                {(pairStatus === 'idle' || pairStatus === 'error') && 'Pair & Connect'}
                {pairStatus === 'done' && <><CheckCircle size={14} /> Done</>}
              </button>
            </div>
          </div>
        )}

        {/* ── Tab: PC Info & QR ── */}
        {tab === 'pcinfo' && (
          <div className="p-5">
            <p className="mb-3 text-xs text-muted">
              Scan with a third-party ADB client app on your phone (e.g. <span className="text-zinc-300">WiFiADB</span>,
              <span className="text-zinc-300"> Remote ADB Shell</span>). QR encodes <code className="rounded bg-zinc-700 px-1 py-0.5 font-mono">ip:5555</code>.
            </p>
            <div className="mb-3 rounded-lg border border-yellow-500/20 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-300">
              Android 11+&rsquo;s built-in &ldquo;Pair with QR code&rdquo; scanner will reject this — use the <span className="font-medium">Pair (Android 11+)</span> tab instead.
            </div>

            {/* Interface selector */}
            {localIPs.length > 1 && (
              <div className="mb-4 flex flex-wrap gap-2">
                {localIPs.map(lip => (
                  <button
                    key={lip.ip}
                    onClick={() => setSelectedIP(lip)}
                    className={`rounded-full px-3 py-1 text-xs transition ${
                      selectedIP?.ip === lip.ip
                        ? 'bg-accent text-white'
                        : 'border border-border text-muted hover:border-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    {lip.name} · {lip.ip}
                  </button>
                ))}
              </div>
            )}

            {selectedIP ? (
              <div className="flex gap-4">
                {/* QR code */}
                <div className="shrink-0">
                  {qrError ? (
                    <div className="flex h-[140px] w-[140px] items-center justify-center rounded-lg bg-zinc-700 text-center px-2">
                      <span className="text-xs text-danger">QR generation failed</span>
                    </div>
                  ) : qrDataUrl ? (
                    <img
                      src={qrDataUrl}
                      alt="QR code"
                      width={140}
                      height={140}
                      className="rounded-lg"
                      draggable={false}
                    />
                  ) : (
                    <div className="flex h-[140px] w-[140px] items-center justify-center rounded-lg bg-zinc-700">
                      <QrCode size={40} className="text-muted animate-pulse" />
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="flex flex-col justify-center gap-2.5">
                  <div>
                    <p className="text-xs text-muted">Interface</p>
                    <p className="font-medium text-zinc-200">{selectedIP.name}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted">Address</p>
                    <p className="font-mono font-medium text-zinc-200">{selectedIP.ip}:5555</p>
                  </div>
                  <div>
                    <p className="mb-1 text-xs text-muted">ADB Command</p>
                    <button
                      onClick={copyCommand}
                      className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 font-mono text-xs text-zinc-300 transition hover:border-zinc-500"
                    >
                      <span>adb connect {selectedIP.ip}:5555</span>
                      {copied
                        ? <Check size={12} className="text-success shrink-0" />
                        : <Copy size={12} className="text-muted shrink-0" />
                      }
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="py-6 text-center text-sm text-muted">
                No network interfaces detected
              </div>
            )}

            <p className="mt-4 text-[11px] text-muted">
              Pre-requisite: TCP/IP mode must be active on the device. Run <code className="rounded bg-zinc-700 px-1 py-0.5 font-mono">adb tcpip 5555</code> once via USB, or enable it in Developer Options.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
