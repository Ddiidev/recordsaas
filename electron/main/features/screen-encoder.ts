import log from 'electron-log/main'
import { spawn } from 'node:child_process'
import { app } from 'electron'
import Store from 'electron-store'
import {
  SCREEN_ENCODER_PREFERENCE_SETTING_KEY,
  normalizeScreenEncoderPreference,
  type ScreenEncoderPreference,
  type ScreenEncoderProbeResult,
  type ScreenEncoderStatus,
  type ScreenEncoderVendor,
} from '../../../src/types/screen-encoder'
import { getFFmpegPath } from '../lib/utils'

type HardwareScreenEncoderVendor = Exclude<ScreenEncoderVendor, 'generic'>

type GpuDevice = {
  vendor: HardwareScreenEncoderVendor
  name: string
  active: boolean
}

type EncoderDefinition = {
  encoder: string
  probePrefixArgs?: string[]
  probeFilter?: string
}

const FFMPEG_PATH = getFFmpegPath()
const store = new Store()
const PROBE_TIMEOUT_MS = 7000
const VAAPI_DEVICE_PATH = process.env.RECORDSAAS_VAAPI_DEVICE || '/dev/dri/renderD128'

const encoderProbeCache = new Map<HardwareScreenEncoderVendor, Promise<ScreenEncoderProbeResult>>()
const statusCache = new Map<ScreenEncoderPreference, Promise<ScreenEncoderStatus>>()

const ENCODER_DEFINITIONS: Partial<
  Record<NodeJS.Platform, Partial<Record<HardwareScreenEncoderVendor, EncoderDefinition>>>
> = {
  win32: {
    nvidia: { encoder: 'h264_nvenc' },
    amd: { encoder: 'h264_amf' },
    intel: { encoder: 'h264_qsv' },
  },
  linux: {
    nvidia: { encoder: 'h264_nvenc' },
    amd: {
      encoder: 'h264_vaapi',
      probePrefixArgs: ['-vaapi_device', VAAPI_DEVICE_PATH],
      probeFilter: 'format=nv12,hwupload',
    },
    intel: { encoder: 'h264_qsv' },
  },
  darwin: {
    apple: { encoder: 'h264_videotoolbox' },
  },
}

const VENDOR_PRIORITY: Record<HardwareScreenEncoderVendor, number> = {
  nvidia: 0,
  amd: 1,
  intel: 2,
  apple: 3,
}

const PLATFORM_VENDORS: Partial<Record<NodeJS.Platform, HardwareScreenEncoderVendor[]>> = {
  win32: ['nvidia', 'amd', 'intel'],
  linux: ['nvidia', 'amd', 'intel'],
  darwin: ['apple'],
}

const parseVendorId = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  const parsed = normalized.startsWith('0x') ? Number.parseInt(normalized.slice(2), 16) : Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

const detectVendor = (value: unknown): HardwareScreenEncoderVendor | null => {
  const vendorId = parseVendorId(value)
  if (vendorId === 0x10de) return 'nvidia'
  if (vendorId === 0x1002 || vendorId === 0x1022) return 'amd'
  if (vendorId === 0x8086) return 'intel'
  if (vendorId === 0x106b) return 'apple'

  const text = String(value || '').toLowerCase()
  if (text.includes('nvidia') || text.includes('geforce') || text.includes('quadro')) return 'nvidia'
  if (text.includes('amd') || text.includes('radeon') || text.includes('advanced micro devices')) return 'amd'
  if (text.includes('intel')) return 'intel'
  if (text.includes('apple')) return 'apple'
  return null
}

const extractGpuDevices = (gpuInfo: unknown): GpuDevice[] => {
  const devices: GpuDevice[] = []
  const seenObjects = new Set<object>()

  const visit = (value: unknown, depth: number) => {
    if (!value || depth > 6) return
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, depth + 1))
      return
    }
    if (typeof value !== 'object') return
    if (seenObjects.has(value)) return
    seenObjects.add(value)

    const record = value as Record<string, unknown>
    const vendor =
      detectVendor(record.vendorId) ||
      detectVendor(record.vendorString) ||
      detectVendor(record.driverVendor) ||
      detectVendor(record.deviceString) ||
      detectVendor(record.description) ||
      detectVendor(record.name)

    if (vendor) {
      const name = String(
        record.deviceString || record.description || record.name || record.vendorString || `${vendor} GPU`,
      )
      devices.push({
        vendor,
        name,
        active: record.active === true || record.isActive === true,
      })
    }

    Object.values(record).forEach((nested) => visit(nested, depth + 1))
  }

  visit(gpuInfo, 0)

  const unique = new Map<string, GpuDevice>()
  devices.forEach((device) => {
    const key = `${device.vendor}:${device.name}`
    const current = unique.get(key)
    if (!current || (!current.active && device.active)) unique.set(key, device)
  })

  return Array.from(unique.values()).sort(
    (left, right) =>
      Number(right.active) - Number(left.active) || VENDOR_PRIORITY[left.vendor] - VENDOR_PRIORITY[right.vendor],
  )
}

const runProbe = (
  vendor: HardwareScreenEncoderVendor,
  definition: EncoderDefinition,
): Promise<ScreenEncoderProbeResult> =>
  new Promise((resolve) => {
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      ...(definition.probePrefixArgs || []),
      '-f',
      'lavfi',
      '-i',
      'color=c=black:s=128x128:r=1',
      '-frames:v',
      '1',
      ...(definition.probeFilter ? ['-vf', definition.probeFilter] : []),
      '-c:v',
      definition.encoder,
      '-f',
      'null',
      '-',
    ]
    const child = spawn(FFMPEG_PATH, args, { windowsHide: true })
    let stderr = ''
    let settled = false

    const finish = (available: boolean, reason?: string) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve({
        preference: vendor,
        encoder: definition.encoder,
        available,
        reason,
      })
    }

    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      finish(false, `Probe timed out after ${PROBE_TIMEOUT_MS}ms.`)
    }, PROBE_TIMEOUT_MS)

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
      if (stderr.length > 6000) stderr = stderr.slice(-6000)
    })
    child.once('error', (error) => finish(false, error.message))
    child.once('close', (code) => {
      const detail = stderr.trim().split(/\r?\n/).slice(-3).join(' ')
      finish(code === 0, code === 0 ? undefined : detail || `FFmpeg exited with code ${code ?? 'null'}.`)
    })
  })

const probeVendor = (vendor: HardwareScreenEncoderVendor): Promise<ScreenEncoderProbeResult> => {
  const cached = encoderProbeCache.get(vendor)
  if (cached) return cached

  const definition = ENCODER_DEFINITIONS[process.platform]?.[vendor]
  const probe = definition
    ? runProbe(vendor, definition)
    : Promise.resolve({
        preference: vendor,
        encoder: vendor,
        available: false,
        reason: `${vendor} screen encoding is not supported on ${process.platform}.`,
      })

  encoderProbeCache.set(vendor, probe)
  return probe
}

const buildGenericStatus = (
  preference: ScreenEncoderPreference,
  probes: ScreenEncoderProbeResult[],
  detectedDevice: GpuDevice | undefined,
  fallbackReason?: string,
): ScreenEncoderStatus => ({
  preference,
  detectedVendor: detectedDevice?.vendor || null,
  detectedDevice: detectedDevice?.name,
  selectedVendor: 'generic',
  encoder: 'libx264',
  selectionMode: fallbackReason ? 'fallback' : preference === 'auto' ? 'automatic' : 'manual',
  requestedAvailable: preference === 'auto' || preference === 'generic',
  isHardware: false,
  fallbackReason,
  probes,
  probedAt: new Date().toISOString(),
})

const resolveStatus = async (preference: ScreenEncoderPreference): Promise<ScreenEncoderStatus> => {
  let gpuDevices: GpuDevice[] = []
  try {
    gpuDevices = extractGpuDevices(await app.getGPUInfo('complete'))
  } catch (error) {
    log.warn('[ScreenEncoder] Electron GPU detection failed:', error)
  }

  const detectedDevice = gpuDevices[0]

  if (preference === 'generic') {
    return buildGenericStatus(preference, [], detectedDevice)
  }

  if (preference !== 'auto') {
    const probe = await probeVendor(preference)
    if (probe.available) {
      return {
        preference,
        detectedVendor: detectedDevice?.vendor || null,
        detectedDevice: detectedDevice?.name,
        selectedVendor: preference,
        encoder: probe.encoder,
        selectionMode: 'manual',
        requestedAvailable: true,
        isHardware: true,
        probes: [probe],
        probedAt: new Date().toISOString(),
      }
    }

    return buildGenericStatus(
      preference,
      [probe],
      detectedDevice,
      `${preference} encoder is unavailable. ${probe.reason || 'FFmpeg one-frame encode failed.'}`,
    )
  }

  const candidateOrder = Array.from(
    new Set([...gpuDevices.map((device) => device.vendor), ...(PLATFORM_VENDORS[process.platform] || [])]),
  )
  const probes: ScreenEncoderProbeResult[] = []

  for (const vendor of candidateOrder) {
    const probe = await probeVendor(vendor)
    probes.push(probe)
    if (!probe.available) continue

    const matchedDevice = gpuDevices.find((device) => device.vendor === vendor) || detectedDevice
    return {
      preference,
      detectedVendor: matchedDevice?.vendor || detectedDevice?.vendor || null,
      detectedDevice: matchedDevice?.name || detectedDevice?.name,
      selectedVendor: vendor,
      encoder: probe.encoder,
      selectionMode: 'automatic',
      requestedAvailable: true,
      isHardware: true,
      probes,
      probedAt: new Date().toISOString(),
    }
  }

  return buildGenericStatus(
    preference,
    probes,
    detectedDevice,
    'No compatible hardware encoder completed the FFmpeg one-frame probe.',
  )
}

export const getScreenEncoderStatus = async (refresh = false): Promise<ScreenEncoderStatus> => {
  const preference = normalizeScreenEncoderPreference(store.get(SCREEN_ENCODER_PREFERENCE_SETTING_KEY, 'auto'))

  if (refresh) {
    encoderProbeCache.clear()
    statusCache.clear()
  }

  const cached = statusCache.get(preference)
  if (cached) return cached

  const statusPromise = resolveStatus(preference)
  statusCache.set(preference, statusPromise)

  try {
    const status = await statusPromise
    log.info(
      `[ScreenEncoder] preference=${status.preference} detected=${status.detectedVendor || 'unknown'} encoder=${status.encoder} mode=${status.selectionMode} fallback=${status.fallbackReason || 'none'}`,
    )
    return status
  } catch (error) {
    statusCache.delete(preference)
    throw error
  }
}

export const getScreenEncoderDefinition = (
  status?: ScreenEncoderStatus,
): { prefixArgs: string[]; codecArgs: string[] } => {
  switch (status?.encoder) {
    case 'h264_nvenc':
      return {
        prefixArgs: [],
        codecArgs: ['-c:v', 'h264_nvenc', '-preset', 'p1', '-tune', 'll', '-rc', 'constqp', '-qp', '18'],
      }
    case 'h264_amf':
      return {
        prefixArgs: [],
        codecArgs: [
          '-c:v',
          'h264_amf',
          '-usage',
          'lowlatency',
          '-quality',
          'speed',
          '-rc',
          'cqp',
          '-qp_i',
          '18',
          '-qp_p',
          '18',
        ],
      }
    case 'h264_qsv':
      return {
        prefixArgs: [],
        codecArgs: ['-c:v', 'h264_qsv', '-preset', 'veryfast', '-global_quality', '18'],
      }
    case 'h264_vaapi':
      return {
        prefixArgs: ['-vaapi_device', VAAPI_DEVICE_PATH],
        codecArgs: ['-c:v', 'h264_vaapi', '-rc_mode', 'CQP', '-qp', '18'],
      }
    case 'h264_videotoolbox':
      return {
        prefixArgs: [],
        codecArgs: ['-c:v', 'h264_videotoolbox', '-realtime', '1', '-allow_sw', '0', '-q:v', '65'],
      }
    default:
      return {
        prefixArgs: [],
        codecArgs: [
          '-c:v',
          'libx264',
          '-preset',
          'ultrafast',
          '-crf',
          '18',
          '-tune',
          'zerolatency',
          '-profile:v',
          'high',
          '-level',
          '5.1',
        ],
      }
  }
}
