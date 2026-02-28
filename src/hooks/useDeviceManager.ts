import { useState, useEffect, useCallback } from 'react'
import log from 'electron-log/renderer'

type Device = { id: string; name: string }
type DshowDevicePair = { video: Device[]; audio: Device[] }

const DSHOW_CACHE_TTL_MS = 2000
let dshowCache: { timestamp: number; data: DshowDevicePair } | null = null
let dshowInFlight: Promise<DshowDevicePair> | null = null

const toDshowDevicePair = (payload: {
  video: { name: string; alternativeName: string }[]
  audio: { name: string; alternativeName: string }[]
}): DshowDevicePair => ({
  video: payload.video.map((device) => ({ id: device.alternativeName, name: device.name })),
  audio: payload.audio.map((device) => ({ id: device.alternativeName, name: device.name })),
})

const getWindowsDshowDevices = async (): Promise<DshowDevicePair> => {
  const now = Date.now()
  if (dshowCache && now - dshowCache.timestamp < DSHOW_CACHE_TTL_MS) {
    return dshowCache.data
  }

  if (dshowInFlight) {
    return dshowInFlight
  }

  dshowInFlight = window.electronAPI
    .getDshowDevices()
    .then((payload) => {
      const parsed = toDshowDevicePair(payload)
      dshowCache = { timestamp: Date.now(), data: parsed }
      return parsed
    })
    .finally(() => {
      dshowInFlight = null
    })

  return dshowInFlight
}

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

  const fetchBrowserDevices = useCallback(async (kind: 'videoinput' | 'audioinput') => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ [kind === 'videoinput' ? 'video' : 'audio']: true })
      stream.getTracks().forEach((track) => track.stop())
      log.debug(`[DeviceManager] Media permission granted for ${kind}`)
    } catch (err) {
      log.warn(`[DeviceManager] Could not get media permissions for ${kind}:`, err)
    }

    const allDevices = await navigator.mediaDevices.enumerateDevices()
    const filtered = allDevices
      .filter((device) => device.kind === kind)
      .map((device) => ({
        // Use the label as the ID so FFmpeg can reference the device by friendly name via dshow.
        // Falls back to deviceId (browser GUID) only when the label is unavailable.
        id: device.label || device.deviceId,
        name: device.label || `Unnamed ${kind === 'videoinput' ? 'Webcam' : 'Microphone'}`,
      }))

    log.debug(`[DeviceManager] enumerateDevices ${kind}: ${filtered.length} devices found`)
    return filtered
  }, [])

  /**
   * Loads all devices concurrently.
   */
  const loadAll = useCallback(async () => {
    setIsInitializing(true)
    log.debug('[DeviceManager] Loading all devices...')
    try {
      const currentPlatform = platform ?? (await window.electronAPI.getPlatform())
      if (!platform) setPlatform(currentPlatform)

      let fetchedWebcams: Device[] = []
      let fetchedMics: Device[] = []

      if (currentPlatform === 'win32') {
        const dshowDevices = await getWindowsDshowDevices()
        fetchedWebcams = dshowDevices.video
        fetchedMics = dshowDevices.audio

        if (fetchedWebcams.length === 0) {
          log.warn('[DeviceManager] dshow returned 0 video devices on Windows. Falling back to browser enumeration.')
          fetchedWebcams = await fetchBrowserDevices('videoinput')
        }
        if (fetchedMics.length === 0) {
          log.warn('[DeviceManager] dshow returned 0 audio devices on Windows. Falling back to browser enumeration.')
          fetchedMics = await fetchBrowserDevices('audioinput')
        }
      } else {
        ;[fetchedWebcams, fetchedMics] = await Promise.all([
          fetchBrowserDevices('videoinput'),
          fetchBrowserDevices('audioinput'),
        ])
      }

      setWebcams(fetchedWebcams)
      setMics(fetchedMics)
      log.info(`[DeviceManager] Devices loaded: ${fetchedWebcams.length} webcams, ${fetchedMics.length} mics`)
    } catch (error) {
      log.error('[DeviceManager] Failed to load devices:', error)
    } finally {
      setIsInitializing(false)
    }
  }, [fetchBrowserDevices, platform])

  // Initial load on mount
  useEffect(() => {
    loadAll()
  }, [loadAll])

  return { platform, webcams, mics, isInitializing, reload: loadAll }
}
