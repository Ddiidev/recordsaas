// Handlers for file system-related IPC (file system).

import fs from 'node:fs/promises'
import { normalizeMediaPath } from '../../lib/media-url'

const MAX_FILE_CHUNK_SIZE_BYTES = 64 * 1024 * 1024

type FileStatResult = {
  size: number
  isFile: boolean
}

type ReadFileChunkPayload = {
  filePath: string
  offset: number
  length: number
}

const resolveFilePath = (filePath: string): string => normalizeMediaPath(filePath) || filePath

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

export async function handleSaveProject(
  _event: unknown,
  payload: { targetFolder: string; projectData: string; mediaFiles: string[] }
): Promise<{ success: boolean; error?: string }> {
  try {
    const { targetFolder, projectData, mediaFiles } = payload
    
    // 1. Ensure target folder exists
    await fs.mkdir(targetFolder, { recursive: true })

    // 2. Write project.rsproj (JSON content with custom extension)
    const path = await import('node:path')
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
