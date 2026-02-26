// Handlers for file system-related IPC (file system).

import fs from 'node:fs/promises'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function handleReadFile(_event: any, filePath: string): Promise<string> {
  return fs.readFile(filePath, 'utf-8')
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function handleReadFileBuffer(_event: any, filePath: string): Promise<Buffer> {
  return fs.readFile(filePath)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function handleSaveProject(
  _event: any,
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
  } catch (error: any) {
    console.error('Error saving project:', error)
    return { success: false, error: error.message }
  }
}
