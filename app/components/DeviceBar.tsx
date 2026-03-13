'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Device } from '@/types/electron'
import { Smartphone, Monitor, Wifi, UsbIcon, RefreshCw, Plus, SmartphoneNfc } from 'lucide-react'
import { ConnectDialog } from './ConnectDialog'
import { QRConnectDialog } from './QRConnectDialog'

interface Props {
  selectedDevice: Device | null
  onSelectDevice: (device: Device | null) => void
}

export function DeviceBar({ selectedDevice, onSelectDevice }: Props) {
  const [devices, setDevices] = useState<Device[]>([])
  const [loading, setLoading] = useState(true)
  const [showConnect, setShowConnect] = useState(false)
  const [showQRConnect, setShowQRConnect] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const list = await window.adb.listDevices()
      setDevices(list)
      // Auto-select first connected device if none selected
      if (!selectedDevice) {
        const connected = list.find(d => d.state === 'device')
        if (connected) onSelectDevice(connected)
      }
    } catch { /* adb error */ }
    setLoading(false)
  }, [selectedDevice, onSelectDevice])

  // Poll for devices every 3 seconds
  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 3000)
    return () => clearInterval(id)
  }, [refresh])

  return (
    <>
      <div className="flex h-full w-60 shrink-0 flex-col border-r border-border bg-panel">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted">Devices</span>
          <button
            onClick={refresh}
            disabled={loading}
            className="rounded p-1 text-muted transition hover:bg-zinc-700 hover:text-zinc-300 disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* Device list */}
        <div className="flex-1 overflow-y-auto py-2">
          {devices.length === 0 && !loading && (
            <div className="px-4 py-6 text-center text-xs text-muted">
              No devices found.<br />Connect via USB or wireless.
            </div>
          )}

          {devices.map((device) => (
            <button
              key={device.serial}
              onClick={() => onSelectDevice(device.state === 'device' ? device : null)}
              className={`w-full px-3 py-2.5 text-left transition ${
                selectedDevice?.serial === device.serial
                  ? 'bg-accent/10 border-l-2 border-accent'
                  : 'border-l-2 border-transparent hover:bg-zinc-700/50'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <DeviceIcon device={device} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-zinc-200">
                    {device.model !== 'Unknown' ? device.model : device.serial}
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <StatusDot state={device.state} />
                    <span className="truncate text-xs text-muted">
                      {deviceStateLabel(device)}
                    </span>
                  </div>
                </div>
              </div>
              {device.androidVersion && (
                <div className="mt-1 ml-8">
                  <span className="rounded bg-zinc-700 px-1.5 py-0.5 text-xs text-muted">
                    Android {device.androidVersion}
                  </span>
                </div>
              )}
            </button>
          ))}
        </div>

        {/* Bottom actions */}
        <div className="border-t border-border p-3 space-y-2">
          <button
            onClick={() => setShowConnect(true)}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-zinc-700/60 px-3 py-2 text-sm text-zinc-300 transition hover:bg-zinc-700 hover:text-zinc-100"
          >
            <Plus size={14} />
            Connect (IP:Port)
          </button>
          <button
            onClick={() => setShowQRConnect(true)}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-zinc-400 transition hover:border-accent hover:bg-accent/10 hover:text-accent"
          >
            <SmartphoneNfc size={14} />
            Pair / QR Connect
          </button>
        </div>
      </div>

      {showConnect && (
        <ConnectDialog
          onClose={() => setShowConnect(false)}
          onConnected={refresh}
        />
      )}

      {showQRConnect && (
        <QRConnectDialog
          onClose={() => setShowQRConnect(false)}
          onConnected={refresh}
        />
      )}
    </>
  )
}

function DeviceIcon({ device }: { device: Device }) {
  const cls = 'shrink-0 text-muted'
  if (device.transport === 'emulator') return <Monitor size={16} className={cls} />
  if (device.transport === 'tcpip') return <Wifi size={16} className={cls} />
  return <UsbIcon size={16} className={cls} />
}

function StatusDot({ state }: { state: Device['state'] }) {
  const color = {
    device: 'bg-success',
    offline: 'bg-zinc-600',
    unauthorized: 'bg-yellow-500',
    connecting: 'bg-blue-400 animate-pulse',
  }[state]
  return <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${color}`} />
}

function deviceStateLabel(device: Device): string {
  if (device.state === 'device') return device.serial
  if (device.state === 'unauthorized') return 'Unauthorized — allow on device'
  if (device.state === 'offline') return 'Offline'
  if (device.state === 'connecting') return 'Connecting…'
  return device.serial
}
