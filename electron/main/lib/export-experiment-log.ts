import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

let exportExperimentLogPath: string | null = null

export const prepareExportExperimentLog = (): string | null => {
  try {
    const directory = path.join(app.getPath('userData'), 'logs', 'export-experiment')
    fs.rmSync(directory, { recursive: true, force: true })
    fs.mkdirSync(directory, { recursive: true })

    exportExperimentLogPath = path.join(directory, 'export-performance.jsonl')
    fs.appendFileSync(
      exportExperimentLogPath,
      `${JSON.stringify({ timestamp: new Date().toISOString(), event: 'app-opened' })}\n`,
      'utf8',
    )
    return exportExperimentLogPath
  } catch {
    exportExperimentLogPath = null
    return null
  }
}

export const writeExportExperimentLog = (event: string, details: Record<string, unknown> = {}): void => {
  if (!exportExperimentLogPath) return

  try {
    fs.appendFileSync(
      exportExperimentLogPath,
      `${JSON.stringify({ timestamp: new Date().toISOString(), event, ...details })}\n`,
      'utf8',
    )
  } catch {
    // Experimental diagnostics must never interrupt an export.
  }
}
