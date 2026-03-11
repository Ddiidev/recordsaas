#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const releaseTag = process.env.RECORDSAAS_BINARY_RELEASE_TAG || 'v0.0.1'
const baseUrl =
  process.env.RECORDSAAS_BINARY_BASE_URL ||
  `https://github.com/Ddiidev/recordsaas-assets/releases/download/${releaseTag}`

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

async function hasUsableBinary(filePath) {
  try {
    const stats = await fs.stat(filePath)
    return stats.isFile() && stats.size > 0
  } catch {
    return false
  }
}

if (await hasUsableBinary(currentTarget.outputPath)) {
  await ensureExecutableBit(currentTarget.outputPath)
  console.log(`[setup:binaries] FFmpeg ready at ${currentTarget.outputPath}`)
  process.exit(0)
}

await fs.mkdir(path.dirname(currentTarget.outputPath), { recursive: true })

const assetUrl = `${baseUrl}/${currentTarget.assetName}`
console.log(`[setup:binaries] Downloading FFmpeg from ${assetUrl}`)

const response = await fetch(assetUrl)
if (!response.ok) {
  throw new Error(`Failed to download FFmpeg (${response.status} ${response.statusText}) from ${assetUrl}`)
}

const binaryData = Buffer.from(await response.arrayBuffer())
await fs.writeFile(currentTarget.outputPath, binaryData)
await ensureExecutableBit(currentTarget.outputPath)

console.log(`[setup:binaries] FFmpeg saved to ${currentTarget.outputPath}`)
