'use client'

import { useState, useEffect } from 'react'
import type { Device } from '@/types/electron'
import { AdbSetupDialog } from './components/AdbSetupDialog'
import { DeviceBar } from './components/DeviceBar'
import { AppGrid } from './components/AppGrid'
import { InstallPanel } from './components/InstallPanel'
import { Smartphone } from 'lucide-react'

export default function Home() {
  const [adbReady, setAdbReady] = useState(false)
  const [adbChecking, setAdbChecking] = useState(true)
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.adb.checkAdb().then((result) => {
      setAdbReady(result.found)
      setAdbChecking(false)
    })
  }, [])

  if (adbChecking) {
    return (
      <div className="flex h-screen items-center justify-center bg-surface">
        <div className="flex flex-col items-center gap-3 text-muted">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          <span className="text-sm">Detecting ADB…</span>
        </div>
      </div>
    )
  }

  if (!adbReady) {
    return <AdbSetupDialog onReady={() => setAdbReady(true)} />
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <DeviceBar selectedDevice={selectedDevice} onSelectDevice={setSelectedDevice} />

      <div className="flex flex-1 flex-col overflow-hidden">
        {selectedDevice ? (
          <>
            <div className="flex-1 overflow-hidden">
              <AppGrid device={selectedDevice} />
            </div>
            <InstallPanel device={selectedDevice} />
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-muted">
            <Smartphone size={56} className="opacity-20" />
            <div className="text-center">
              <p className="text-lg font-medium text-zinc-400">No device selected</p>
              <p className="mt-1 text-sm">Connect an Android device via USB or wireless ADB</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
