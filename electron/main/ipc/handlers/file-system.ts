// Handlers for file system-related IPC (file system).

import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Dirent, Stats } from 'node:fs'
import { app, dialog, IpcMainInvokeEvent } from 'electron'
import Store from 'electron-store'
import { normalizeMediaPath, toMediaUrl } from '../../lib/media-url'
import { getFFmpegPath } from '../../lib/utils'

const MAX_FILE_CHUNK_SIZE_BYTES = 64 * 1024 * 1024
const RECORDSAAS_ROOT_SETTING_KEY = 'storage.recordsaasRootPath'
const DEFAULT_GENERAL_PROJECT_FOLDER = 'General'
const PROJECT_FILE_NAME = 'project.rsproj'
const PROJECT_THUMBNAIL_FILE_NAME = '.thumbnail.png'
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
const execFileAsync = promisify(execFile)

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

type SavedProjectListItem = {
  name: string
  folderPath: string
  projectFilePath: string
  thumbnailPath?: string
  thumbnailUrl?: string
  recordedAt: string
  sizeBytes: number
  isLegacy: boolean
}

type ListSavedProjectsResult = {
  success: boolean
  rootPath?: string
  projects?: SavedProjectListItem[]
  error?: string
}

type SaveProjectPayload = {
  targetFolder: string
  projectData: string
  mediaFiles: string[]
  thumbnailSourcePath?: string | null
  thumbnailTimeSeconds?: number | null
  confirmReplaceExisting?: boolean
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

const resolveProjectFolderPath = (
  projectName: string,
): { success: true; targetFolder: string; normalizedName: string } | { success: false; error: string } => {
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

const pathExists = async (filePath: string): Promise<boolean> => {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

const isInsideRecordSaaSRoot = (targetFolder: string): boolean => {
  const rootPath = path.resolve(getConfiguredRecordSaaSRootPath())
  const resolvedTarget = path.resolve(resolveFilePath(targetFolder))
  const relativePath = path.relative(rootPath, resolvedTarget)

  return Boolean(relativePath) && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)
}

const confirmReplaceExistingProject = async (targetFolder: string): Promise<boolean> => {
  const result = await dialog.showMessageBox({
    type: 'warning',
    title: 'Project already exists',
    message: `A project named "${path.basename(targetFolder)}" already exists.`,
    detail: `Click "Substituir" to delete the existing project folder and save the new project there.\n\n${targetFolder}`,
    buttons: ['OK', 'Substituir'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  })

  return result.response === 1
}

const getDirectorySize = async (directoryPath: string): Promise<number> => {
  let totalSize = 0
  let entries: Dirent[]

  try {
    entries = await fs.readdir(directoryPath, { withFileTypes: true })
  } catch {
    return 0
  }

  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue

    const entryPath = path.join(directoryPath, entry.name)
    if (entry.isDirectory()) {
      totalSize += await getDirectorySize(entryPath)
      continue
    }

    if (entry.isFile()) {
      try {
        const stat = await fs.stat(entryPath)
        totalSize += stat.size
      } catch {
        // Keep project listing available even if one file is unavailable.
      }
    }
  }

  return totalSize
}

const readProjectJson = async (projectFilePath: string): Promise<Record<string, unknown> | null> => {
  try {
    const rawData = await fs.readFile(projectFilePath, 'utf-8')
    const parsed = JSON.parse(rawData)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch (error) {
    console.error(`Failed to read project metadata from ${projectFilePath}:`, error)
    return null
  }
}

const parseProjectDate = (value: unknown): Date | null => {
  if (typeof value !== 'string' && typeof value !== 'number') return null

  const parsedDate = new Date(value)
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate
}

const extractProjectDate = (projectData: Record<string, unknown> | null): Date | null => {
  if (!projectData) return null

  for (const key of ['recordedAt', 'recordingStartedAt', 'createdAt', 'createdOn', 'date']) {
    const parsedDate = parseProjectDate(projectData[key])
    if (parsedDate) return parsedDate
  }

  return null
}

const extractProjectName = (projectData: Record<string, unknown> | null, folderPath: string): string => {
  if (projectData) {
    for (const key of ['projectName', 'name', 'title']) {
      const value = projectData[key]
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim()
      }
    }
  }

  return path.basename(folderPath)
}

const getProjectFallbackDate = (projectFileStat: Stats, folderStat: Stats): Date =>
  projectFileStat.birthtime.getTime() > 0
    ? projectFileStat.birthtime
    : folderStat.birthtime.getTime() > 0
      ? folderStat.birthtime
      : projectFileStat.mtime.getTime() > 0
        ? projectFileStat.mtime
        : folderStat.mtime

const runThumbnailExtraction = async (
  sourcePath: string,
  thumbnailPath: string,
  timeSeconds: number,
): Promise<void> => {
  const safeTime = Number.isFinite(timeSeconds) ? Math.max(0, timeSeconds) : 0
  const args = [
    '-y',
    '-ss',
    safeTime.toFixed(3),
    '-i',
    sourcePath,
    '-frames:v',
    '1',
    '-vf',
    'scale=480:-2',
    thumbnailPath,
  ]

  await execFileAsync(getFFmpegPath(), args, { windowsHide: true, maxBuffer: 10 * 1024 * 1024 })
}

const generateProjectThumbnail = async (
  sourcePath: string,
  thumbnailPath: string,
  timeSeconds: number | null | undefined,
): Promise<void> => {
  const resolvedSourcePath = resolveFilePath(sourcePath)
  await fs.access(resolvedSourcePath)

  const safeTime = typeof timeSeconds === 'number' && Number.isFinite(timeSeconds) ? timeSeconds : 0
  try {
    await runThumbnailExtraction(resolvedSourcePath, thumbnailPath, safeTime)
  } catch (error) {
    if (safeTime <= 0) throw error
    await runThumbnailExtraction(resolvedSourcePath, thumbnailPath, 0)
  }
}

const hideProjectThumbnailFile = async (thumbnailPath: string): Promise<void> => {
  if (process.platform !== 'win32') return

  try {
    await execFileAsync('attrib', ['+h', thumbnailPath], { windowsHide: true })
  } catch (error) {
    console.error(`Failed to hide project thumbnail ${thumbnailPath}:`, error)
  }
}

export async function handleListSavedProjects(): Promise<ListSavedProjectsResult> {
  const rootPath = getConfiguredRecordSaaSRootPath()

  try {
    let entries: Dirent[]
    try {
      entries = await fs.readdir(rootPath, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { success: true, rootPath, projects: [] }
      }
      throw error
    }

    const projectItems = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry): Promise<SavedProjectListItem | null> => {
          const folderPath = path.join(rootPath, entry.name)
          const projectFilePath = path.join(folderPath, PROJECT_FILE_NAME)

          let projectFileStat: Stats
          try {
            projectFileStat = await fs.stat(projectFilePath)
          } catch {
            return null
          }

          if (!projectFileStat.isFile()) return null

          const [folderStat, projectData] = await Promise.all([fs.stat(folderPath), readProjectJson(projectFilePath)])
          const explicitProjectDate = extractProjectDate(projectData)
          const recordedAt = (explicitProjectDate || getProjectFallbackDate(projectFileStat, folderStat)).toISOString()
          const thumbnailPath = path.join(folderPath, PROJECT_THUMBNAIL_FILE_NAME)
          const hasThumbnail = await pathExists(thumbnailPath)
          const thumbnailUrl = hasThumbnail ? toMediaUrl(thumbnailPath) || undefined : undefined
          const sizeBytes = await getDirectorySize(folderPath)

          return {
            name: extractProjectName(projectData, folderPath),
            folderPath,
            projectFilePath,
            thumbnailPath: hasThumbnail ? thumbnailPath : undefined,
            thumbnailUrl,
            recordedAt,
            sizeBytes,
            isLegacy: !hasThumbnail || !explicitProjectDate,
          }
        }),
    )

    const projects = projectItems
      .filter((projectItem): projectItem is SavedProjectListItem => Boolean(projectItem))
      .sort((a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime())

    return { success: true, rootPath, projects }
  } catch (error: unknown) {
    console.error('Error listing saved projects:', error)
    return { success: false, rootPath, error: error instanceof Error ? error.message : 'Unknown list error' }
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

export function handleResolveProjectFolder(
  _event: unknown,
  projectName: string,
): { success: boolean; targetFolder?: string; normalizedName?: string; error?: string } {
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
  _event: IpcMainInvokeEvent,
  payload: SaveProjectPayload,
): Promise<{ success: boolean; canceled?: boolean; error?: string }> {
  try {
    const { projectData, mediaFiles, thumbnailSourcePath, thumbnailTimeSeconds, confirmReplaceExisting } = payload
    const targetFolder = path.resolve(resolveFilePath(payload.targetFolder))

    if (confirmReplaceExisting && (await pathExists(targetFolder))) {
      if (!isInsideRecordSaaSRoot(targetFolder)) {
        return { success: false, error: 'Cannot replace a project folder outside the RecordSaaS root.' }
      }

      const shouldReplace = await confirmReplaceExistingProject(targetFolder)
      if (!shouldReplace) {
        return { success: false, canceled: true }
      }

      await fs.rm(targetFolder, { recursive: true, force: true })
    }

    // 1. Ensure target folder exists
    await fs.mkdir(targetFolder, { recursive: true })

    // 2. Write project.rsproj (JSON content with custom extension)
    const projectFilePath = path.join(targetFolder, PROJECT_FILE_NAME)
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

    if (thumbnailSourcePath) {
      const sourcePath = resolveFilePath(thumbnailSourcePath)
      const copiedSourcePath = path.join(targetFolder, path.basename(sourcePath))
      const thumbnailInputPath = (await pathExists(copiedSourcePath)) ? copiedSourcePath : sourcePath
      const thumbnailPath = path.join(targetFolder, PROJECT_THUMBNAIL_FILE_NAME)

      try {
        await generateProjectThumbnail(thumbnailInputPath, thumbnailPath, thumbnailTimeSeconds)
        await hideProjectThumbnailFile(thumbnailPath)
      } catch (thumbnailError) {
        console.error(`Failed to create project thumbnail from ${thumbnailInputPath}:`, thumbnailError)
      }
    }

    return { success: true }
  } catch (error: unknown) {
    console.error('Error saving project:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown save error' }
  }
}
