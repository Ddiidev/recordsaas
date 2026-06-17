#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const assetsRepo = process.env.RECORDSAAS_BINARY_REPO || 'Ddiidev/recordsaas-assets'
const configuredReleaseTag = process.env.RECORDSAAS_BINARY_RELEASE_TAG
const configuredBaseUrl = process.env.RECORDSAAS_BINARY_BASE_URL
const forceDotnetHelperBuild = process.env.RECORDSAAS_FORCE_DOTNET_HELPER_BUILD === '1'
const configuredGithubToken =
  process.env.RECORDSAAS_BINARY_GITHUB_TOKEN || process.env.GITHUB_TOKEN || process.env.GH_TOKEN
const windowsSystemAudioProjectPath = path.join(projectRoot, 'native', 'RecordSaaS.SystemAudio', 'RecordSaaS.SystemAudio.csproj')
const windowsSystemAudioProjectDir = path.dirname(windowsSystemAudioProjectPath)
const windowsSystemAudioOutputPath = path.join(projectRoot, 'binaries', 'windows', 'recordsaas-system-audio.exe')

const platformTargets = {
  linux: {
    assetName: 'ffmpeg',
    outputPath: path.join(projectRoot, 'binaries', 'linux', 'ffmpeg'),
    needsExecutableBit: true,
    requiredDemuxer: 'pulse',
  },
  win32: {
    assetName: 'ffmpeg.exe',
    outputPath: path.join(projectRoot, 'binaries', 'windows', 'ffmpeg.exe'),
    needsExecutableBit: false,
    expectedVersionText: 'ffmpeg version 8.1.1',
  },
  darwin: {
    assetName: process.arch === 'arm64' ? 'ffmpeg-darwin-arm64' : 'ffmpeg-darwin-x64',
    outputPath: path.join(projectRoot, 'binaries', 'darwin', process.arch === 'arm64' ? 'ffmpeg-arm64' : 'ffmpeg-x64'),
    needsExecutableBit: true,
  },
}

const currentTarget = platformTargets[process.platform]

if (!currentTarget) {
  console.warn(`[setup:binaries] Unsupported platform "${process.platform}". Skipping FFmpeg setup.`)
  process.exit(0)
}

async function ensureExecutableBit(filePath) {
  if (!currentTarget.needsExecutableBit) {
    return
  }

  await fs.chmod(filePath, 0o755)
}

async function getLatestHelperSourceMTimeMs(directoryPath) {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true })
  let latestMTimeMs = 0

  for (const entry of entries) {
    if (entry.name === 'bin' || entry.name === 'obj') {
      continue
    }

    const entryPath = path.join(directoryPath, entry.name)
    const stats = await fs.stat(entryPath)
    if (stats.isDirectory()) {
      latestMTimeMs = Math.max(latestMTimeMs, await getLatestHelperSourceMTimeMs(entryPath))
    } else if (stats.isFile()) {
      latestMTimeMs = Math.max(latestMTimeMs, stats.mtimeMs)
    }
  }

  return latestMTimeMs
}

async function ensureWindowsSystemAudioHelper() {
  if (process.platform !== 'win32') {
    return
  }

  await fs.mkdir(path.dirname(windowsSystemAudioOutputPath), { recursive: true })

  if (!forceDotnetHelperBuild) {
    try {
      const [sourceMTimeMs, outputStats] = await Promise.all([
        getLatestHelperSourceMTimeMs(windowsSystemAudioProjectDir),
        fs.stat(windowsSystemAudioOutputPath),
      ])

      if (outputStats.isFile() && outputStats.size > 0 && outputStats.mtimeMs >= sourceMTimeMs) {
        const probeResult = probeBinary(windowsSystemAudioOutputPath, ['--probe'])
        if (!probeResult.error && probeResult.status === 0) {
          console.log(`[setup:binaries] Reusing existing Windows system-audio helper at ${windowsSystemAudioOutputPath}`)
          return
        }
      }
    } catch {
      // Missing or stale helper falls through to publish.
    }
  }

  if (forceDotnetHelperBuild) {
    console.log('[setup:binaries] Forcing rebuild of Windows system-audio helper.')
  } else {
    console.log('[setup:binaries] Building Windows system-audio helper because the existing binary is missing, stale, or invalid.')
  }

  const publishResult = spawnSync(
    'dotnet',
    [
      'publish',
      windowsSystemAudioProjectPath,
      '-c',
      'Release',
      '-r',
      'win-x64',
      '--self-contained',
      'true',
      '/p:PublishSingleFile=true',
      '/p:EnableCompressionInSingleFile=true',
      '/p:PublishTrimmed=false',
      '-o',
      path.dirname(windowsSystemAudioOutputPath),
    ],
    {
      encoding: 'utf-8',
      timeout: 300000,
    },
  )

  if (publishResult.error) {
    throw publishResult.error
  }

  if (publishResult.status !== 0) {
    throw new Error((publishResult.stderr || publishResult.stdout || `dotnet publish failed with code ${publishResult.status}`).trim())
  }

  const probeResult = probeBinary(windowsSystemAudioOutputPath, ['--probe'])
  if (probeResult.error || probeResult.status !== 0) {
    throw new Error(
      (probeResult.stderr || probeResult.stdout || probeResult.error?.message || 'System audio helper probe failed.').trim(),
    )
  }

  console.log(`[setup:binaries] Windows system-audio helper ready at ${windowsSystemAudioOutputPath}`)
}

function probeBinary(filePath, args = ['-hide_banner', '-version']) {
  return spawnSync(filePath, args, {
    encoding: 'utf-8',
    timeout: 4000,
  })
}

async function inspectBinary(filePath) {
  try {
    const stats = await fs.stat(filePath)
    if (!stats.isFile() || stats.size <= 0) {
      return { exists: false, runnable: false, versionOk: false, demuxerOk: false, detail: 'file missing or empty' }
    }
  } catch {
    return { exists: false, runnable: false, versionOk: false, demuxerOk: false, detail: 'file missing or empty' }
  }

  await ensureExecutableBit(filePath)

  const probeResult = probeBinary(filePath)
  if (probeResult.error) {
    return {
      exists: true,
      runnable: false,
      versionOk: false,
      demuxerOk: false,
      detail: probeResult.error.message,
    }
  }

  if (probeResult.status !== 0) {
    return {
      exists: true,
      runnable: false,
      versionOk: false,
      demuxerOk: false,
      detail: (probeResult.stderr || probeResult.stdout || `exit code ${probeResult.status}`).trim(),
    }
  }

  let versionOk = true
  if (currentTarget.expectedVersionText) {
    const versionOutput = `${probeResult.stdout || ''}\n${probeResult.stderr || ''}`
    if (!versionOutput.includes(currentTarget.expectedVersionText)) {
      versionOk = false
    }
  }

  let demuxerOk = true
  let demuxerDetail = ''
  if (currentTarget.requiredDemuxer) {
    const demuxerResult = probeBinary(filePath, ['-hide_banner', '-h', `demuxer=${currentTarget.requiredDemuxer}`])
    const demuxerOutput = `${demuxerResult.stdout || ''}\n${demuxerResult.stderr || ''}`

    if (demuxerResult.error || demuxerResult.status !== 0 || demuxerOutput.includes(`Unknown format '${currentTarget.requiredDemuxer}'`)) {
      demuxerOk = false
      demuxerDetail = (demuxerResult.stderr || demuxerResult.stdout || demuxerResult.error?.message || `exit code ${demuxerResult.status}`).trim()
    }
  }

  return {
    exists: true,
    runnable: true,
    versionOk,
    demuxerOk,
    detail: demuxerDetail,
  }
}

async function fetchJson(url) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'recordsaas-setup-binaries',
  }

  if (configuredGithubToken) {
    headers.Authorization = `Bearer ${configuredGithubToken}`
  }

  const response = await fetch(url, {
    headers,
  })

  if (!response.ok) {
    const rateLimitRemaining = response.headers.get('x-ratelimit-remaining')
    const rateLimitReset = response.headers.get('x-ratelimit-reset')
    let hint = ''

    if (response.status === 403 && rateLimitRemaining === '0') {
      hint = configuredGithubToken
        ? ' (authenticated GitHub API rate limit exhausted)'
        : ' (GitHub API rate limit exhausted; configure GITHUB_TOKEN/GH_TOKEN to raise the limit)'

      if (rateLimitReset) {
        hint += ` until unix ${rateLimitReset}`
      }
    }

    throw new Error(`Failed to fetch JSON (${response.status} ${response.statusText}) from ${url}${hint}`)
  }

  return response.json()
}

function resolveDirectAssetUrl(assetName) {
  if (configuredBaseUrl) {
    return configuredBaseUrl.replace(/\/$/, '') + `/${assetName}`
  }

  const encodedAssetName = encodeURIComponent(assetName)

  if (configuredReleaseTag) {
    return `https://github.com/${assetsRepo}/releases/download/${encodeURIComponent(configuredReleaseTag)}/${encodedAssetName}`
  }

  return `https://github.com/${assetsRepo}/releases/latest/download/${encodedAssetName}`
}

async function resolveAssetUrlViaApi(assetName) {
  const releasesApiUrl = configuredReleaseTag
    ? `https://api.github.com/repos/${assetsRepo}/releases/tags/${configuredReleaseTag}`
    : `https://api.github.com/repos/${assetsRepo}/releases/latest`
  const release = await fetchJson(releasesApiUrl)
  const asset = release.assets?.find((entry) => entry?.name === assetName)

  if (!asset?.browser_download_url) {
    throw new Error(`Could not find asset "${assetName}" in ${releasesApiUrl}`)
  }

  console.log(`[setup:binaries] Resolved ${assetName} from ${assetsRepo} release ${release.tag_name}`)
  return asset.browser_download_url
}

async function downloadAsset(url) {
  const headers = {
    Accept: 'application/octet-stream',
    'User-Agent': 'recordsaas-setup-binaries',
  }

  if (configuredGithubToken) {
    headers.Authorization = `Bearer ${configuredGithubToken}`
  }

  return fetch(url, { headers })
}

const existingBinary = await inspectBinary(currentTarget.outputPath)

if (existingBinary.runnable && existingBinary.versionOk && existingBinary.demuxerOk) {
  await ensureWindowsSystemAudioHelper()
  console.log(`[setup:binaries] FFmpeg ready at ${currentTarget.outputPath}`)
  process.exit(0)
}

if (existingBinary.exists && existingBinary.runnable && !existingBinary.versionOk) {
  console.warn(
    `[setup:binaries] Existing binary at ${currentTarget.outputPath} does not match ${currentTarget.expectedVersionText}. It will be refreshed.`,
  )
}

if (existingBinary.exists && existingBinary.runnable && !existingBinary.demuxerOk) {
  console.warn(
    `[setup:binaries] Existing binary at ${currentTarget.outputPath} does not support required demuxer "${currentTarget.requiredDemuxer}": ${existingBinary.detail}`,
  )
}

if (existingBinary.exists && !existingBinary.runnable) {
  console.warn(`[setup:binaries] Existing binary at ${currentTarget.outputPath} is invalid: ${existingBinary.detail}`)
}

await fs.mkdir(path.dirname(currentTarget.outputPath), { recursive: true })

let assetUrl = resolveDirectAssetUrl(currentTarget.assetName)
console.log(`[setup:binaries] Downloading FFmpeg from ${assetUrl}`)

let response = await downloadAsset(assetUrl)

if (!response.ok && !configuredBaseUrl) {
  console.warn(
    `[setup:binaries] Direct release download failed (${response.status} ${response.statusText}). Falling back to GitHub API lookup.`,
  )

  assetUrl = await resolveAssetUrlViaApi(currentTarget.assetName)
  console.log(`[setup:binaries] Retrying FFmpeg download from ${assetUrl}`)
  response = await downloadAsset(assetUrl)
}

if (!response.ok) {
  throw new Error(`Failed to download FFmpeg (${response.status} ${response.statusText}) from ${assetUrl}`)
}

const contentType = response.headers.get('content-type') || ''

if (contentType.includes('text/html')) {
  const bodyPreview = (await response.text()).slice(0, 200).replace(/\s+/g, ' ').trim()
  throw new Error(`Expected FFmpeg binary from ${assetUrl}, but received HTML instead. Preview: ${bodyPreview}`)
}

const binaryData = Buffer.from(await response.arrayBuffer())
await fs.writeFile(currentTarget.outputPath, binaryData)
await ensureExecutableBit(currentTarget.outputPath)

const downloadedBinary = await inspectBinary(currentTarget.outputPath)

if (!downloadedBinary.runnable || !downloadedBinary.versionOk) {
  throw new Error(`Downloaded FFmpeg asset is invalid: ${currentTarget.outputPath}`)
}

if (!downloadedBinary.demuxerOk && currentTarget.requiredDemuxer) {
  console.warn(
    `[setup:binaries] Downloaded FFmpeg still lacks required demuxer "${currentTarget.requiredDemuxer}". Continuing without computer-audio support until assets release is updated.`,
  )
  console.warn(`[setup:binaries] Demuxer probe detail: ${downloadedBinary.detail}`)
}

console.log(`[setup:binaries] FFmpeg saved to ${currentTarget.outputPath}`)

await ensureWindowsSystemAudioHelper()
