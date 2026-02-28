import { useState, useEffect, useCallback } from 'react'
import log from 'electron-log/renderer'

type Device = { id: string; name: string }

/**
 * Custom hook to manage loading and reloading of media devices (webcams, microphones).
 * It handles platform-specific logic (dshow on Windows) and provides a unified interface.
 *
 * @returns An object containing device lists, loading status, platform info, and a reload function.
 */
export const useDeviceManager = () => {
  const [platform, setPlatform] = useState<NodeJS.Platform | null>(null)
  const [webcams, setWebcams] = useState<Device[]>([])
  const [mics, setMics] = useState<Device[]>([])
  const [isInitializing, setIsInitializing] = useState(true)

  /**
   * Fetches devices of a specific kind, handling platform differences.
   */
  const fetchDevices = useCallback(
    async (kind: 'videoinput' | 'audioinput') => {
      const currentPlatform = platform ?? (await window.electronAPI.getPlatform())
      if (!platform) setPlatform(currentPlatform)

      log.debug(`[DeviceManager] Fetching ${kind} devices on ${currentPlatform}`)

      if (currentPlatform === 'win32') {
        const { video, audio } = await window.electronAPI.getDshowDevices()
        const devices = (kind === 'videoinput' ? video : audio).map((d) => ({ id: d.alternativeName, name: d.name }))
        log.debug(`[DeviceManager] dshow ${kind}: ${devices.length} devices found`)
        return devices
      }

      try {
        // Request permission to ensure device labels are available
        const stream = await navigator.mediaDevices.getUserMedia({ [kind === 'videoinput' ? 'video' : 'audio']: true })
        stream.getTracks().forEach((track) => track.stop())
        log.debug(`[DeviceManager] Media permission granted for ${kind}`)
      } catch (err) {
        log.warn(`[DeviceManager] Could not get media permissions for ${kind}:`, err)
      }
      const allDevices = await navigator.mediaDevices.enumerateDevices()
      const filtered = allDevices
        .filter((d) => d.kind === kind)
        .map((d) => ({ id: d.deviceId, name: d.label || `Unnamed ${kind === 'videoinput' ? 'Webcam' : 'Microphone'}` }))
      log.debug(`[DeviceManager] enumerateDevices ${kind}: ${filtered.length} devices found`)
      return filtered
    },
    [platform],
  )

  /**
   * Loads all devices concurrently.
   */
  const loadAll = useCallback(async () => {
    setIsInitializing(true)
    log.debug('[DeviceManager] Loading all devices...')
    try {
      const [fetchedWebcams, fetchedMics] = await Promise.all([fetchDevices('videoinput'), fetchDevices('audioinput')])
      setWebcams(fetchedWebcams)
      setMics(fetchedMics)
      log.info(`[DeviceManager] Devices loaded: ${fetchedWebcams.length} webcams, ${fetchedMics.length} mics`)
    } catch (error) {
      log.error('[DeviceManager] Failed to load devices:', error)
    } finally {
      setIsInitializing(false)
    }
  }, [fetchDevices])

  // Initial load on mount
  useEffect(() => {
    loadAll()
  }, [loadAll])

  return { platform, webcams, mics, isInitializing, reload: loadAll }
}
