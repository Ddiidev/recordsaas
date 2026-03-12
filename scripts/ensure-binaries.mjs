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
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'recordsaas-setup-binaries',
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch JSON (${response.status} ${response.statusText}) from ${url}`)
  }

  return response.json()
}

async function resolveAssetUrl(assetName) {
  if (configuredBaseUrl) {
    return configuredBaseUrl.replace(/\/$/, '') + `/${assetName}`
  }

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

if (await hasUsableBinary(currentTarget.outputPath)) {
  console.log(`[setup:binaries] FFmpeg ready at ${currentTarget.outputPath}`)
  process.exit(0)
}

await fs.mkdir(path.dirname(currentTarget.outputPath), { recursive: true })

const assetUrl = await resolveAssetUrl(currentTarget.assetName)
console.log(`[setup:binaries] Downloading FFmpeg from ${assetUrl}`)

const response = await fetch(assetUrl)
if (!response.ok) {
  throw new Error(`Failed to download FFmpeg (${response.status} ${response.statusText}) from ${assetUrl}`)
}

const binaryData = Buffer.from(await response.arrayBuffer())
await fs.writeFile(currentTarget.outputPath, binaryData)
await ensureExecutableBit(currentTarget.outputPath)

if (!(await hasUsableBinary(currentTarget.outputPath))) {
  throw new Error(`Downloaded FFmpeg asset is invalid: ${currentTarget.outputPath}`)
}

console.log(`[setup:binaries] FFmpeg saved to ${currentTarget.outputPath}`)
