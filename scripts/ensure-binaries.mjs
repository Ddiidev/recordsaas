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
const configuredGithubToken =
  process.env.RECORDSAAS_BINARY_GITHUB_TOKEN || process.env.GITHUB_TOKEN || process.env.GH_TOKEN

const platformTargets = {
  linux: {
    assetName: 'ffmpeg',
    outputPath: path.join(projectRoot, 'binaries', 'linux', 'ffmpeg'),
    needsExecutableBit: true,
  },
  win32: {
    assetName: 'ffmpeg.exe',
    outputPath: path.join(projectRoot, 'binaries', 'windows', 'ffmpeg.exe'),
    needsExecutableBit: false,
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

function probeBinary(filePath) {
  return spawnSync(filePath, ['-hide_banner', '-version'], {
    encoding: 'utf-8',
    timeout: 4000,
  })
}

async function hasUsableBinary(filePath) {
  try {
    const stats = await fs.stat(filePath)
    if (!stats.isFile() || stats.size <= 0) {
      return false
    }
  } catch {
    return false
  }

  await ensureExecutableBit(filePath)

  const probeResult = probeBinary(filePath)
  if (probeResult.error) {
    console.warn(`[setup:binaries] Existing binary at ${filePath} is invalid: ${probeResult.error.message}`)
    return false
  }

  if (probeResult.status !== 0) {
    const detail = (probeResult.stderr || probeResult.stdout || `exit code ${probeResult.status}`).trim()
    console.warn(`[setup:binaries] Existing binary at ${filePath} is invalid: ${detail}`)
    return false
  }

  return true
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

if (await hasUsableBinary(currentTarget.outputPath)) {
  console.log(`[setup:binaries] FFmpeg ready at ${currentTarget.outputPath}`)
  process.exit(0)
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

if (!(await hasUsableBinary(currentTarget.outputPath))) {
  throw new Error(`Downloaded FFmpeg asset is invalid: ${currentTarget.outputPath}`)
}

console.log(`[setup:binaries] FFmpeg saved to ${currentTarget.outputPath}`)
