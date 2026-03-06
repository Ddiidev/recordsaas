// Handlers for file system-related IPC (file system).

import fs from 'node:fs/promises'

export async function handleReadFile(_event: unknown, filePath: string): Promise<string> {
  return fs.readFile(filePath, 'utf-8')
}

export async function handleReadFileBuffer(_event: unknown, filePath: string): Promise<Buffer> {
  return fs.readFile(filePath)
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
        let sourcePath = file
        if (sourcePath.startsWith('media://')) {
          sourcePath = sourcePath.replace('media://', '')
        }
        
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
