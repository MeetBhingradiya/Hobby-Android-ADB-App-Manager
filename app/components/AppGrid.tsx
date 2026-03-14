'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Device, PackageInfo, DeviceUser } from '@/types/electron'
import { RefreshCw, Search, Package, Users, Lock } from 'lucide-react'
import { AppCard } from './AppCard'

interface Props {
  device: Device
}

export function AppGrid({ device }: Props) {
  const [packages, setPackages] = useState<PackageInfo[]>([])
  const [filtered, setFiltered] = useState<PackageInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [includeSystem, setIncludeSystem] = useState(false)
  const [query, setQuery] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const [users, setUsers] = useState<DeviceUser[]>([])
  const [selectedUserId, setSelectedUserId] = useState(0)

  // Fetch users once per device
  useEffect(() => {
    setSelectedUserId(0)
    window.adb.listUsers(device.serial).then(list => {
      setUsers(list)
    }).catch(() => setUsers([{ id: 0, name: 'Owner' }]))
  }, [device.serial])

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const list = await window.adb.listPackages(device.serial, includeSystem, selectedUserId)
      setPackages(list)
    } catch (err) {
      setPackages([])
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('SecurityException') || msg.includes('permission')) {
        setLoadError('Cannot access this user profile — ADB shell lacks permission (root required for Knox/Secure Folder)')
      } else {
        setLoadError('Failed to load packages')
      }
    }
    setLoading(false)
  }, [device.serial, includeSystem, selectedUserId])

  useEffect(() => { load() }, [load, refreshKey])

  // Filter whenever query or packages change
  useEffect(() => {
    const q = query.toLowerCase().trim()
    if (!q) {
      setFiltered(packages)
    } else {
      setFiltered(packages.filter(p => p.packageName.toLowerCase().includes(q)))
    }
  }, [query, packages])

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-3 bg-panel">
        {/* Device title */}
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-zinc-200 truncate">{device.model}</span>
          <span className="ml-2 text-xs text-muted">{packages.length} apps</span>
        </div>

        {/* User selector — shown only when device has multiple users */}
        {users.length > 1 && (
          <div className="flex items-center gap-1.5">
            <Users size={13} className="text-muted shrink-0" />
            <select
              value={selectedUserId}
              onChange={e => setSelectedUserId(Number(e.target.value))}
              className="rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-zinc-100 outline-none focus:border-accent"
            >
              {users.map(u => (
                <option key={u.id} value={u.id}>
                  {u.name} (user {u.id})
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Search */}
        <div className="relative w-52">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search packages…"
            className="w-full rounded-lg border border-border bg-surface pl-7 pr-3 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-accent"
          />
        </div>

        {/* System toggle */}
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <span className="text-xs text-muted">System</span>
          <div
            onClick={() => setIncludeSystem(v => !v)}
            className={`relative h-5 w-9 cursor-pointer rounded-full transition-colors ${
              includeSystem ? 'bg-accent' : 'bg-zinc-700'
            }`}
          >
            <div className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
              includeSystem ? 'translate-x-4' : 'translate-x-0.5'
            }`} />
          </div>
        </label>

        {/* Refresh */}
        <button
          onClick={() => setRefreshKey(k => k + 1)}
          disabled={loading}
          className="rounded p-1.5 text-muted transition hover:bg-zinc-700 hover:text-zinc-300 disabled:opacity-40"
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-muted">
          <RefreshCw size={16} className="animate-spin" />
          <span className="text-sm">Loading packages…</span>
        </div>
      ) : loadError ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center text-muted">
          <Lock size={32} className="opacity-40" />
          <span className="text-sm text-danger">{loadError}</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted">
          <Package size={32} className="opacity-30" />
          <span className="text-sm">{query ? 'No results' : 'No packages found'}</span>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-2 overflow-y-auto p-4">
          {filtered.map(pkg => (
            <AppCard
              key={pkg.packageName}
              device={device}
              pkg={pkg}
              onUninstalled={() => setRefreshKey(k => k + 1)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
