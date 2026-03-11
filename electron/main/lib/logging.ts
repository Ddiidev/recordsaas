// Sets up the logging system.

import log from 'electron-log/main'
import path from 'node:path'

export function getMainLogFilePath() {
  return path.join(process.cwd(), 'recordsaas-main.log')
}

export function setupLogging() {
  const logFilePath = getMainLogFilePath()

  log.transports.file.level = 'debug'
  log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}'
  log.transports.file.maxSize = 5 * 1024 * 1024 // 5 MB
  log.transports.file.resolvePathFn = () => logFilePath

  log.transports.console.level = 'debug'
  // if (process.env.NODE_ENV !== 'development') {
  //   log.transports.console.level = false;
  // }

  process.on('uncaughtException', (error) => {
    log.error('Unhandled Exception:', error)
  })

  process.on('unhandledRejection', (reason, promise) => {
    log.error('Unhandled Rejection at:', promise, 'reason:', reason)
  })

  log.info(`[Logging] Logging initialized. File: ${logFilePath}`)
}
