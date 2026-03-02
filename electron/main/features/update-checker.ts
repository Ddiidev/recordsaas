import log from 'electron-log/main'
import { app, net, BrowserWindow } from 'electron'

const LATEST_VERSION_URL = 'https://recordsaas.app/api/latest-version'

const PLATFORM_KEY: Record<string, 'windows' | 'mac' | 'linux'> = {
  win32: 'windows',
  darwin: 'mac',
  linux: 'linux',
}

interface LatestVersionResponse {
  version: string
  downloads: {
    windows: string
    mac: string
    linux: string
  }
}

function isNewer(latest: string, current: string): boolean {
  const [lMaj, lMin, lPatch] = latest.split('.').map(Number)
  const [cMaj, cMin, cPatch] = current.split('.').map(Number)
  if (lMaj !== cMaj) return lMaj > cMaj
  if (lMin !== cMin) return lMin > cMin
  return lPatch > cPatch
}

export async function checkForUpdates(window: BrowserWindow | null) {
  if (!window) return

  const currentVersion = app.getVersion()
  const maxAttempts = 3
  let currentAttempt = 0

  const attemptRequest = () => {
    currentAttempt++
    log.info(`[UpdateCheck] Attempt ${currentAttempt}/${maxAttempts}...`)

    const request = net.request({ method: 'GET', url: LATEST_VERSION_URL })

    request.on('response', (response) => {
      if (response.statusCode === 200) {
        let body = ''
        response.on('data', (chunk) => {
          body += chunk.toString()
        })
        response.on('end', () => {
          try {
            const data: LatestVersionResponse = JSON.parse(body)
            const latestVersion = data.version

            if (isNewer(latestVersion, currentVersion)) {
              log.info(`[UpdateCheck] New version available: ${latestVersion}`)
              const platform = PLATFORM_KEY[process.platform] ?? 'windows'
              const downloadUrl = data.downloads[platform]
              window.webContents.send('update:available', { version: latestVersion, url: downloadUrl })
            } else {
              log.info(`[UpdateCheck] App is up to date (${currentVersion}).`)
            }
          } catch (error) {
            log.error('[UpdateCheck] Failed to parse response:', error)
          }
        })
      } else if (currentAttempt < maxAttempts) {
        log.warn(`[UpdateCheck] HTTP ${response.statusCode}, retrying...`)
        setTimeout(attemptRequest, 3000)
      } else {
        log.warn(`[UpdateCheck] HTTP ${response.statusCode}, giving up.`)
      }
    })

    request.on('error', (error) => {
      log.warn(`[UpdateCheck] Network error:`, error.message)
      if (currentAttempt < maxAttempts) {
        setTimeout(attemptRequest, 3000)
      }
    })

    request.end()
  }

  attemptRequest()
}
