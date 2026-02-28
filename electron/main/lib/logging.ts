// Sets up the logging system with hourly rotation, system context, and improved exception handling.

import log from 'electron-log/main'
import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { appState } from '../state'

const LOG_RETENTION_DAYS = 7
const DEFAULT_CONSOLE_LOG_LEVEL = (process.env.RECORDSAAS_LOG_LEVEL || 'info') as typeof log.transports.console.level

/**
 * Returns the logs directory path: `{userData}/logs/`
 */
export function getLogsDirectory(): string {
  return path.join(app.getPath('userData'), 'logs')
}

/**
 * Returns a snapshot of system context for diagnostics.
 */
function getSystemContext(): Record<string, unknown> {
  return {
    appVersion: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    osVersion: os.release(),
    totalMemoryMB: Math.round(os.totalmem() / 1024 / 1024),
    freeMemoryMB: Math.round(os.freemem() / 1024 / 1024),
    cpus: os.cpus().length,
    locale: app.getLocale(),
  }
}

/**
 * Returns a snapshot of the current app state for diagnostics.
 */
function getAppStateSnapshot(): Record<string, unknown> {
  return {
    recorderWinOpen: !!appState.recorderWin && !appState.recorderWin.isDestroyed(),
    editorWinOpen: !!appState.editorWin && !appState.editorWin.isDestroyed(),
    renderWorkerOpen: !!appState.renderWorker && !appState.renderWorker.isDestroyed(),
    ffmpegRunning: !!appState.ffmpegProcess,
    mouseTrackerActive: !!appState.mouseTracker,
    hasRecordingSession: !!appState.currentRecordingSession,
    recordingSystemAudioMode: appState.currentRecordingSession?.systemAudioCaptureMode || null,
    hasEditorSession: !!appState.currentEditorSessionFiles,
    isCleanupInProgress: appState.isCleanupInProgress,
  }
}

/**
 * Deletes log files older than LOG_RETENTION_DAYS.
 */
function cleanupOldLogs(logsDir: string): void {
  try {
    if (!fs.existsSync(logsDir)) return

    const cutoff = Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000
    const files = fs.readdirSync(logsDir)

    for (const file of files) {
      if (!file.endsWith('.log')) continue
      const filePath = path.join(logsDir, file)
      try {
        const stats = fs.statSync(filePath)
        if (stats.mtimeMs < cutoff) {
          fs.unlinkSync(filePath)
          log.info(`[Logging] Deleted old log file: ${file}`)
        }
      } catch {
        // Ignore errors on individual files
      }
    }
  } catch {
    // Non-critical — don't block startup
  }
}

/**
 * Generates the hourly log file name: `recordsaas_YYYY-MM-DD_HH.log`
 */
function getHourlyLogFileName(): string {
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  const hh = String(now.getHours()).padStart(2, '0')
  return `recordsaas_${yyyy}-${mm}-${dd}_${hh}.log`
}

export function setupLogging() {
  const logsDir = getLogsDirectory()

  // Ensure logs directory exists
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true })
  }

  // Hourly rotation via resolvePathFn
  log.transports.file.resolvePathFn = () => {
    return path.join(logsDir, getHourlyLogFileName())
  }

  log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}'
  log.transports.file.maxSize = 0 // Disable size-based rotation (we use hourly)

  log.transports.console.level = DEFAULT_CONSOLE_LOG_LEVEL

  // Improved exception handlers with system context and app state
  process.on('uncaughtException', (error) => {
    log.error('Unhandled Exception:', error)
    log.error('[Exception Context] System:', getSystemContext())
    log.error('[Exception Context] AppState:', getAppStateSnapshot())
  })

  process.on('unhandledRejection', (reason, promise) => {
    log.error('Unhandled Rejection at:', promise, 'reason:', reason)
    log.error('[Rejection Context] System:', getSystemContext())
    log.error('[Rejection Context] AppState:', getAppStateSnapshot())
  })

  // Cleanup old logs on startup
  cleanupOldLogs(logsDir)

  // Startup log with full system context
  log.info('[Logging] Logging initialized.')
  log.info('[Startup] System context:', getSystemContext())
  log.info(`[Startup] Logs directory: ${logsDir}`)
}
