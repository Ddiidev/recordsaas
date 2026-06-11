// Handlers for file system-related IPC (file system).

import fs from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import Store from 'electron-store'
import { normalizeMediaPath } from '../../lib/media-url'

const MAX_FILE_CHUNK_SIZE_BYTES = 64 * 1024 * 1024
const RECORDSAAS_ROOT_SETTING_KEY = 'storage.recordsaasRootPath'
const DEFAULT_GENERAL_PROJECT_FOLDER = 'General'
const WINDOWS_RESERVED_FOLDER_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
])

const store = new Store()

type FileStatResult = {
  size: number
  isFile: boolean
}

type ReadFileChunkPayload = {
  filePath: string
  offset: number
  length: number
}

type FolderNameValidationResult = {
  valid: boolean
  normalizedName?: string
  error?: string
}

const resolveFilePath = (filePath: string): string => normalizeMediaPath(filePath) || filePath

const getDefaultRecordSaaSRootPath = (): string => path.join(app.getPath('documents'), 'RecordSaaS')

const getConfiguredRecordSaaSRootPath = (): string => {
  const configuredPath = store.get(RECORDSAAS_ROOT_SETTING_KEY)
  if (typeof configuredPath === 'string' && configuredPath.trim().length > 0) {
    return path.resolve(resolveFilePath(configuredPath.trim()))
  }
  return getDefaultRecordSaaSRootPath()
}

const hasControlCharacter = (value: string): boolean => {
  for (const char of value) {
    if (char.charCodeAt(0) <= 31) return true
  }
  return false
}

const validateFolderName = (rawName: unknown): FolderNameValidationResult => {
  if (typeof rawName !== 'string') {
    return { valid: false, error: 'Project name is required.' }
  }

  const normalizedName = rawName.trim()
  if (!normalizedName) {
    return { valid: false, error: 'Project name is required.' }
  }

  if (normalizedName === '.' || normalizedName === '..') {
    return { valid: false, error: 'Project name cannot be a relative path.' }
  }

  if (normalizedName.length > 120) {
    return { valid: false, error: 'Project name is too long.' }
  }

  if (hasControlCharacter(normalizedName)) {
    return { valid: false, error: 'Project name contains unsupported control characters.' }
  }

  if (process.platform === 'win32') {
    if (/[<>:"/\\|?*]/.test(normalizedName)) {
      return { valid: false, error: 'Project name contains characters Windows cannot use in folder names.' }
    }

    if (/[. ]$/.test(normalizedName)) {
      return { valid: false, error: 'Project name cannot end with a dot or space on Windows.' }
    }

    const reservedName = normalizedName.split('.')[0]?.toUpperCase()
    if (reservedName && WINDOWS_RESERVED_FOLDER_NAMES.has(reservedName)) {
      return { valid: false, error: 'Project name is reserved by Windows.' }
    }
  } else if (normalizedName.includes('/')) {
    return { valid: false, error: 'Project name cannot contain path separators.' }
  }

  return { valid: true, normalizedName }
}

const resolveProjectFolderPath = (projectName: string): { success: true; targetFolder: string; normalizedName: string } | { success: false; error: string } => {
  const validation = validateFolderName(projectName)
  if (!validation.valid || !validation.normalizedName) {
    return { success: false, error: validation.error || 'Invalid project name.' }
  }

  return {
    success: true,
    normalizedName: validation.normalizedName,
    targetFolder: path.join(getConfiguredRecordSaaSRootPath(), validation.normalizedName),
  }
}

export async function handleReadFile(_event: unknown, filePath: string): Promise<string> {
  return fs.readFile(resolveFilePath(filePath), 'utf-8')
}

export async function handleReadFileBuffer(_event: unknown, filePath: string): Promise<Buffer> {
  return fs.readFile(resolveFilePath(filePath))
}

export async function handleStatFile(_event: unknown, filePath: string): Promise<FileStatResult> {
  const stat = await fs.stat(resolveFilePath(filePath))
  return {
    size: stat.size,
    isFile: stat.isFile(),
  }
}

export async function handleReadFileChunk(_event: unknown, payload: ReadFileChunkPayload): Promise<Buffer> {
  const { filePath, offset, length } = payload

  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new RangeError(`Invalid file chunk offset: ${offset}`)
  }

  if (!Number.isSafeInteger(length) || length <= 0) {
    throw new RangeError(`Invalid file chunk length: ${length}`)
  }

  const chunkLength = Math.min(length, MAX_FILE_CHUNK_SIZE_BYTES)
  const file = await fs.open(resolveFilePath(filePath), 'r')

  try {
    const buffer = Buffer.allocUnsafe(chunkLength)
    const { bytesRead } = await file.read(buffer, 0, chunkLength, offset)
    return buffer.subarray(0, bytesRead)
  } finally {
    await file.close()
  }
}

export function handleGetRecordSaaSRootPath(): string {
  return getConfiguredRecordSaaSRootPath()
}

export function handleGetDefaultRecordSaaSRootPath(): string {
  return getDefaultRecordSaaSRootPath()
}

export function handleValidateProjectFolderName(_event: unknown, projectName: string): FolderNameValidationResult {
  return validateFolderName(projectName)
}

export function handleResolveProjectFolder(_event: unknown, projectName: string): { success: boolean; targetFolder?: string; normalizedName?: string; error?: string } {
  return resolveProjectFolderPath(projectName)
}

export function handleResolveExportOutputPath(
  _event: unknown,
  payload: { projectFolder?: string | null; filename: string },
): { success: boolean; outputPath?: string; error?: string } {
  const filename = typeof payload?.filename === 'string' ? path.basename(payload.filename.trim()) : ''
  if (!filename) {
    return { success: false, error: 'Export filename is required.' }
  }

  const targetFolder = payload.projectFolder
    ? path.resolve(resolveFilePath(payload.projectFolder))
    : path.join(getConfiguredRecordSaaSRootPath(), DEFAULT_GENERAL_PROJECT_FOLDER)

  return {
    success: true,
    outputPath: path.join(targetFolder, filename),
  }
}

export async function handleSaveProject(
  _event: unknown,
  payload: { targetFolder: string; projectData: string; mediaFiles: string[] }
): Promise<{ success: boolean; error?: string }> {
  try {
    const { targetFolder, projectData, mediaFiles } = payload
    
    // 1. Ensure target folder exists
    await fs.mkdir(targetFolder, { recursive: true })

    // 2. Write project.rsproj (JSON content with custom extension)
    const projectFilePath = path.join(targetFolder, 'project.rsproj')
    await fs.writeFile(projectFilePath, projectData, 'utf-8')

    // 3. Copy media files to the target folder
    for (const file of mediaFiles) {
      if (file) {
        const sourcePath = resolveFilePath(file)
        
        const fileName = path.basename(sourcePath)
        const destPath = path.join(targetFolder, fileName)

        // Prevent copying if source and dest are the same
        if (sourcePath !== destPath) {
          try {
            await fs.copyFile(sourcePath, destPath)
          } catch (copyErr) {
            console.error(`Failed to copy ${sourcePath} to ${destPath}:`, copyErr)
          }
        }
      }
    }

    return { success: true }
  } catch (error: unknown) {
    console.error('Error saving project:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown save error' }
  }
}
