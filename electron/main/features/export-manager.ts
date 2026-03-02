// Contains business logic for video export.

import log from 'electron-log/main'
import { app, BrowserWindow, IpcMainInvokeEvent, ipcMain, Menu, Tray, nativeImage, shell, powerSaveBlocker } from 'electron'
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import { constants as osConstants, getPriority, setPriority } from 'node:os'
import Store from 'electron-store'
import { appState } from '../state'
import { getFFmpegPath, calculateExportDimensions } from '../lib/utils'
import { spawnSync } from 'node:child_process'
import { VITE_DEV_SERVER_URL, RENDERER_DIST, PRELOAD_SCRIPT, VITE_PUBLIC } from '../lib/constants'
import { createExportProgressWindow } from '../windows/temporary-windows'
import { authorizeDesktopExport, type ExportSelectionRequest } from './auth-manager'

const FFMPEG_PATH = getFFmpegPath()
const EXPORT_PROGRESS_INTERVAL_MS = 300
const EXPORT_PROGRESS_STEP_PERCENT = 2
const POSIX_PRIORITY_CANDIDATES = [-10, -5]
const WINDOWS_PRIORITY_CANDIDATES = [
  osConstants.priority.PRIORITY_HIGH,
  osConstants.priority.PRIORITY_ABOVE_NORMAL,
]
const WINDOWS_NORMAL_PRIORITY = osConstants.priority.PRIORITY_NORMAL
const store = new Store()

type LaneLike = { id: string; order: number }
type CutLike = { startTime: number; duration: number; laneId?: string; zIndex?: number }
type SpeedLike = { startTime: number; duration: number; speed: number; laneId?: string; zIndex?: number }
type ExportQuality = 'low' | 'medium' | 'high' | 'ultra high'

const sortLanesForPrecedence = (lanes: LaneLike[] | undefined): LaneLike[] => {
  const source = Array.isArray(lanes) && lanes.length > 0 ? lanes : [{ id: 'lane-1', order: 0 }]
  return [...source]
    .sort((a, b) => (a.order === b.order ? a.id.localeCompare(b.id) : a.order - b.order))
    .map((lane, index) => ({ ...lane, order: index }))
}

const regionOverlapsTime = (region: { startTime: number; duration: number }, time: number): boolean =>
  time >= region.startTime && time < region.startTime + region.duration

const chooseTopActiveRegion = <T extends { laneId?: string; zIndex?: number; duration: number; startTime: number }>(
  regions: T[],
  time: number,
  laneIndexMap: Map<string, number>,
  laneCount: number,
): T | null => {
  const active = regions.filter((region) => regionOverlapsTime(region, time))
  if (active.length === 0) return null

  active.sort((a, b) => {
    const laneA = a.laneId ? (laneIndexMap.get(a.laneId) ?? laneCount + 1) : laneCount + 1
    const laneB = b.laneId ? (laneIndexMap.get(b.laneId) ?? laneCount + 1) : laneCount + 1
    if (laneA !== laneB) return laneA - laneB

    const zDiff = (b.zIndex ?? 0) - (a.zIndex ?? 0)
    if (zDiff !== 0) return zDiff

    const durationDiff = a.duration - b.duration
    if (durationDiff !== 0) return durationDiff

    return b.startTime - a.startTime
  })

  return active[0]
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value))

const buildAudioTimelineSegments = (
  duration: number,
  cutRegions: CutLike[],
  speedRegions: SpeedLike[],
  lanes: LaneLike[] | undefined,
): Array<{ start: number; duration: number; speed: number }> => {
  if (duration <= 0) return []

  const sortedLanes = sortLanesForPrecedence(lanes)
  const laneIndexMap = new Map(sortedLanes.map((lane, index) => [lane.id, index]))
  const boundaries = new Set<number>([0, duration])

  cutRegions.forEach((region) => {
    boundaries.add(clamp(region.startTime, 0, duration))
    boundaries.add(clamp(region.startTime + region.duration, 0, duration))
  })
  speedRegions.forEach((region) => {
    boundaries.add(clamp(region.startTime, 0, duration))
    boundaries.add(clamp(region.startTime + region.duration, 0, duration))
  })

  const sortedBoundaries = Array.from(boundaries)
    .sort((a, b) => a - b)
    .filter((time, index, arr) => index === 0 || time !== arr[index - 1])

  const segments: Array<{ start: number; duration: number; speed: number }> = []

  for (let i = 0; i < sortedBoundaries.length - 1; i++) {
    const start = sortedBoundaries[i]
    const end = sortedBoundaries[i + 1]
    const sourceDuration = end - start
    if (sourceDuration <= 0) continue

    const midpoint = start + sourceDuration / 2
    const activeCut = chooseTopActiveRegion(cutRegions, midpoint, laneIndexMap, sortedLanes.length)
    if (activeCut) continue

    const activeSpeed = chooseTopActiveRegion(speedRegions, midpoint, laneIndexMap, sortedLanes.length)
    const speed = activeSpeed && activeSpeed.speed > 0 ? activeSpeed.speed : 1
    segments.push({ start, duration: sourceDuration, speed })
  }

  return segments
}

const getTargetPriorityCandidates = () =>
  process.platform === 'win32' ? WINDOWS_PRIORITY_CANDIDATES : POSIX_PRIORITY_CANDIDATES

const getNormalPriority = () => (process.platform === 'win32' ? WINDOWS_NORMAL_PRIORITY : 0)

const trySetProcessPriority = (pid: number, priority: number, label: string) => {
  try {
    setPriority(pid, priority)
    log.info(`[ExportManager] Priority set for ${label}: pid=${pid}, priority=${priority}`)
    return true
  } catch (error) {
    log.warn(`[ExportManager] Failed to set priority for ${label}:`, error)
    return false
  }
}

const trySetProcessPriorityWithFallback = (pid: number, priorities: number[], label: string) => {
  for (const priority of priorities) {
    if (trySetProcessPriority(pid, priority, label)) {
      return true
    }
  }

  return false
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function startExport(event: IpcMainInvokeEvent, { projectState, exportSettings, outputPath }: any) {
  log.info('[ExportManager] Starting export process...')

  const exportStartTime = Date.now()
  const getElapsedDurationSeconds = () => (Date.now() - exportStartTime) / 1000

  const editorWindow = BrowserWindow.fromWebContents(event.sender)
  if (!editorWindow) return
  const playExportCompletionSound = Boolean(store.get('general.playExportCompletionSound', true))
  const wasEditorVisibleBeforeExport = editorWindow.isVisible()
  const wasEditorMinimizedBeforeExport = editorWindow.isMinimized()
  const wasEditorSkipTaskbarBeforeExport =
    (editorWindow as unknown as { isSkipTaskbar?: () => boolean }).isSkipTaskbar?.() ?? false
  const targetPriorityCandidates = getTargetPriorityCandidates()
  const normalPriorityFallback = getNormalPriority()
  let originalMainProcessPriority = normalPriorityFallback
  let mainPriorityBoostApplied = false
  let ffmpegClosed = false
  let exportCompleted = false
  let uiCleanedUp = false
  let powerSaveBlockerId: number | null = null
  let lastProgressBroadcastAt = 0
  let lastProgressBroadcast = -1
  let cancellationHandler: () => void = () => {}

  const safeExportSettings = exportSettings && typeof exportSettings === 'object' ? exportSettings : {}
  const requestedExportSettings: ExportSelectionRequest & { quality: ExportQuality } = {
    format: safeExportSettings.format === 'gif' ? 'gif' : 'mp4',
    resolution:
      safeExportSettings.resolution === '480p' ||
      safeExportSettings.resolution === '576p' ||
      safeExportSettings.resolution === '720p' ||
      safeExportSettings.resolution === '1080p' ||
      safeExportSettings.resolution === '2k'
        ? safeExportSettings.resolution
        : '720p',
    fps: safeExportSettings.fps === 60 ? 60 : 30,
    quality:
      safeExportSettings.quality === 'low' ||
      safeExportSettings.quality === 'medium' ||
      safeExportSettings.quality === 'high' ||
      safeExportSettings.quality === 'ultra high'
        ? safeExportSettings.quality
        : 'medium',
  }

  const authorizedExport = await authorizeDesktopExport({
    format: requestedExportSettings.format,
    resolution: requestedExportSettings.resolution,
    fps: requestedExportSettings.fps,
  })

  const normalizedExportSettings = {
    ...requestedExportSettings,
    format: authorizedExport.approved.format,
    resolution: authorizedExport.approved.resolution,
    fps: authorizedExport.approved.fps,
  }

  const outputDir = path.dirname(outputPath)
  if (!fs.existsSync(outputDir)) {
    log.info(`[ExportManager] Creating missing directory: ${outputDir}`)
    fs.mkdirSync(outputDir, { recursive: true })
  }

  const playCompletionSound = (completionType: 'success' | 'error' | 'cancelled') => {
    if (!playExportCompletionSound || completionType === 'cancelled') return
    try {
      shell.beep()
    } catch (error) {
      log.warn('[ExportManager] Failed to play export completion sound:', error)
    }
  }

  const sendExportComplete = (
    payload: { success: boolean; outputPath?: string; error?: string; duration?: number },
    completionType: 'success' | 'error' | 'cancelled',
  ) => {
    if (editorWindow && !editorWindow.isDestroyed()) {
      editorWindow.webContents.send('export:complete', payload)
    } else {
      log.warn('[ExportManager] Editor window was destroyed. Could not send export:complete message.')
    }

    const exportProgressWindow = appState.exportProgressWin
    if (exportProgressWindow && !exportProgressWindow.isDestroyed()) {
      exportProgressWindow.webContents.send('export:complete', payload)
    }

    playCompletionSound(completionType)
  }

  const updateExportTrayTooltip = (progress: number) => {
    if (!appState.exportTray) return
    try {
      appState.exportTray.setToolTip(`Exporting... ${Math.round(progress)}%`)
    } catch (error) {
      log.warn('[ExportManager] Failed to update export tray tooltip:', error)
    }
  }

  const sendProgressUpdate = (progress: number, stage: string, force: boolean = false) => {
    const safeProgress = clamp(progress, 0, 100)
    const now = Date.now()
    const elapsed = now - lastProgressBroadcastAt
    const progressDelta = Math.abs(safeProgress - lastProgressBroadcast)

    const shouldSend =
      force ||
      lastProgressBroadcast < 0 ||
      elapsed >= EXPORT_PROGRESS_INTERVAL_MS ||
      progressDelta >= EXPORT_PROGRESS_STEP_PERCENT ||
      safeProgress >= 100

    if (!shouldSend) return

    lastProgressBroadcastAt = now
    lastProgressBroadcast = safeProgress

    const payload = { progress: safeProgress, stage }

    if (editorWindow && !editorWindow.isDestroyed()) {
      editorWindow.webContents.send('export:progress', payload)
    }

    const exportProgressWindow = appState.exportProgressWin
    if (exportProgressWindow && !exportProgressWindow.isDestroyed()) {
      exportProgressWindow.webContents.send('export:progress', payload)
    }

    updateExportTrayTooltip(safeProgress)
  }

  const handleProgressWindowClose = (closeEvent: Electron.Event) => {
    if (exportCompleted) return
    closeEvent.preventDefault()
    cancellationHandler()
  }

  const showExportProgressWindow = () => {
    const progressWindow = createExportProgressWindow()
    progressWindow.removeListener('close', handleProgressWindowClose)
    progressWindow.on('close', handleProgressWindowClose)
    if (!progressWindow.isVisible()) {
      progressWindow.show()
    }
    progressWindow.focus()
    return progressWindow
  }

  const createExportTray = () => {
    if (appState.exportTray) return

    try {
      const iconPath = path.join(VITE_PUBLIC, 'recordsaas-appicon-tray.png')
      const icon = nativeImage.createFromPath(iconPath)
      if (icon.isEmpty()) {
        throw new Error(`Tray icon not found or invalid: ${iconPath}`)
      }

      const tray = new Tray(icon)
      appState.exportTray = tray
      tray.setToolTip('Exporting... 0%')
      tray.setContextMenu(
        Menu.buildFromTemplate([
          {
            label: 'Show Export Progress',
            click: () => {
              showExportProgressWindow()
            },
          },
          { type: 'separator' },
          {
            label: 'Cancel Export',
            click: () => {
              cancellationHandler()
            },
          },
        ]),
      )
      tray.on('click', () => {
        showExportProgressWindow()
      })
    } catch (error) {
      log.warn('[ExportManager] Failed to create export tray, continuing without tray:', error)
      appState.exportTray = null
    }
  }

  const cleanupExportUi = () => {
    if (uiCleanedUp) return
    uiCleanedUp = true

    const exportProgressWindow = appState.exportProgressWin
    if (exportProgressWindow && !exportProgressWindow.isDestroyed()) {
      exportProgressWindow.removeListener('close', handleProgressWindowClose)
      exportProgressWindow.close()
    }

    if (appState.exportTray) {
      try {
        appState.exportTray.destroy()
      } catch (error) {
        log.warn('[ExportManager] Failed to destroy export tray:', error)
      }
      appState.exportTray = null
    }

    if (editorWindow && !editorWindow.isDestroyed()) {
      editorWindow.setSkipTaskbar(wasEditorSkipTaskbarBeforeExport)

      if (wasEditorVisibleBeforeExport) {
        editorWindow.show()
      }

      if (wasEditorMinimizedBeforeExport) {
        editorWindow.minimize()
      } else if (wasEditorVisibleBeforeExport) {
        if (editorWindow.isMinimized()) {
          editorWindow.restore()
        }
        editorWindow.focus()
      }
    }

    if (powerSaveBlockerId !== null && powerSaveBlocker.isStarted(powerSaveBlockerId)) {
      powerSaveBlocker.stop(powerSaveBlockerId)
      log.info(`[ExportManager] Stopped powerSaveBlocker id=${powerSaveBlockerId}`)
      powerSaveBlockerId = null
    }

    if (mainPriorityBoostApplied) {
      trySetProcessPriority(process.pid, originalMainProcessPriority, 'main-process-restore')
      mainPriorityBoostApplied = false
    }
  }

  try {
    originalMainProcessPriority = getPriority(process.pid)
  } catch (error) {
    log.warn('[ExportManager] Could not read current main process priority. Using fallback restore value.', error)
    originalMainProcessPriority = normalPriorityFallback
  }

  mainPriorityBoostApplied = trySetProcessPriorityWithFallback(process.pid, targetPriorityCandidates, 'main-process')

  try {
    powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension')
    log.info(`[ExportManager] Started powerSaveBlocker id=${powerSaveBlockerId}`)
  } catch (error) {
    log.warn('[ExportManager] Failed to start powerSaveBlocker:', error)
    powerSaveBlockerId = null
  }

  if (appState.renderWorker) {
    appState.renderWorker.close()
  }
  appState.renderWorker = new BrowserWindow({
    show: false,
    width: 1280,
    height: 720,
    webPreferences: {
      preload: PRELOAD_SCRIPT,
      offscreen: false,
      webSecurity: false,
      enableBlinkFeatures: 'WebCodecs,WebCodecsExperimental',
      backgroundThrottling: false,
    },
  })
  if (VITE_DEV_SERVER_URL) {
    const renderUrl = `${VITE_DEV_SERVER_URL}#renderer`
    appState.renderWorker.loadURL(renderUrl)
    log.info(`[ExportManager] Loading render worker URL (Dev): ${renderUrl}`)
  } else {
    const renderPath = path.join(RENDERER_DIST, 'index.html')
    appState.renderWorker.loadFile(renderPath, { hash: 'renderer' })
    log.info(`[ExportManager] Loading render worker file (Prod): ${renderPath}#renderer`)
  }

  const { format, resolution, fps } = normalizedExportSettings
  const { width: outputWidth, height: outputHeight } = calculateExportDimensions(resolution, projectState.aspectRatio)


  // Determine input format based on output format
  // If MP4, we receive H.264 stream from Renderer (WebCodecs)
  // If other (GIF), we receive raw RGBA frames
  const isMp4 = format === 'mp4'

  const ffmpegArgs = ['-y']
  
  if (isMp4) {
    // Input is raw H.264 Byte Stream (Annex B)
    // We specify framerate here so FFmpeg knows how to interpret the stream timing
    ffmpegArgs.push(
       '-thread_queue_size', '1024',
       '-f', 'h264', 
       '-r', fps.toString(), 
       '-i', '-'
    )
  } else {
    ffmpegArgs.push(
      '-f', 'rawvideo',
      '-vcodec', 'rawvideo',
      '-pix_fmt', 'rgba',
      '-s', `${outputWidth}x${outputHeight}`,
      '-r', fps.toString(),
      '-i', '-'
    )
  }

  // If there's an audio track, preprocess it to apply cuts and speed regions
  // so the final audio matches the exported video timeline.
  // This generates a temporary processed audio file (if needed) and uses it
  // as the audio input for FFmpeg.
  let processedAudioPath: string | null = null
  if (projectState.audioPath) {
    try {
      processedAudioPath = await (async function prepareProcessedAudio(): Promise<string | null> {
        const audioPath = projectState.audioPath
        if (!audioPath) return null

        // Build timeline boundaries from cuts and speed regions, respecting lane precedence.
        const duration = projectState.duration
        const cutRegions = Object.values(projectState.cutRegions || {}) as CutLike[]
        const speedRegions = Object.values(projectState.speedRegions || {}) as SpeedLike[]
        const timelineLanes = projectState.timelineLanes as LaneLike[] | undefined
        const segments = buildAudioTimelineSegments(duration, cutRegions, speedRegions, timelineLanes)

        if (segments.length === 0) return null

        // Safe Approach: Create separate segment files and concat them.
        // This avoids complex filter string limits and escaping issues.
        const tmpDir = fs.mkdtempSync(path.join(app.getPath('temp'), 'recordsaas-audio-'))
        const segmentFiles: string[] = []

        // Helper to build atempo filter chain
        const buildAtempoFilter = (factor: number) => {
           if (Math.abs(factor - 1) < 0.01) return null
           const filters: number[] = []
           let remaining = factor
           while (remaining > 2.0) { filters.push(2.0); remaining /= 2.0 }
           while (remaining < 0.5) { filters.push(0.5); remaining /= 0.5 }
           filters.push(remaining)
           return filters.map((f) => `atempo=${f}`).join(',')
        }

        let i = 0
        for (const seg of segments) {
          const outPath = path.join(tmpDir, `seg-${i}.m4a`)
          // Note: using -ss and -t with input seeking is fast but less precise for some container formats.
          // For AAC/M4A, we place -ss BEFORE -i for fast seek, but we must ensure we are accurate.
          // To be perfectly accurate (frame accurate), we should re-encode.
          // We use -vn to discard video if any.
          
          const args: string[] = [
             '-y', 
             '-ss', seg.start.toFixed(4), 
             '-t', seg.duration.toFixed(4), 
             '-i', audioPath, 
             '-vn'
          ]

          const atempo = buildAtempoFilter(seg.speed)
          if (atempo) {
            args.push('-af', atempo, '-c:a', 'aac', '-b:a', '192k')
          } else {
             // Always re-encode for precise cuts, otherwise -c copy snaps to keyframes/packets
            args.push('-c:a', 'aac', '-b:a', '192k')
          }
          args.push(outPath)

          log.info(`[ExportManager] Processing audio segment ${i}: start=${seg.start}, dur=${seg.duration}, speed=${seg.speed}`)
          const res = spawnSync(FFMPEG_PATH, args, { encoding: 'utf-8' })
          
          if (res.status !== 0) {
            log.error('[ExportManager] Failed to create audio segment:', res.stdout, res.stderr)
            // Cleanup: best effort
            try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ignore */ }
            return null
          }
          segmentFiles.push(outPath)
          i++
        }

        // Create concat list file (critical: forward slashes)
        const listFile = path.join(tmpDir, 'concat.txt')
        const listContent = segmentFiles
          .map((f) => {
            const normalizedPath = f.replace(/\\/g, '/')
            return `file '${normalizedPath.replace(/'/g, "'\\''")}'`
          })
          .join('\n')
        
        fs.writeFileSync(listFile, listContent)

        const finalOut = path.join(tmpDir, 'processed.m4a')
        log.info('[ExportManager] Concatenating audio segments...')
        
        const concatRes = spawnSync(FFMPEG_PATH, [
            '-y', 
            '-f', 'concat', 
            '-safe', '0', 
            '-i', listFile, 
            '-c', 'copy', 
            finalOut
        ], { encoding: 'utf-8' })

        if (concatRes.status !== 0) {
          log.error('[ExportManager] Failed to concat audio:', concatRes.stdout, concatRes.stderr)
          try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ignore */ }
          return null
        }

        // Attach temp dir for cleanup NOT as a property of string, but we manage it implicitly. 
        // We can't attach prop to string primitive.
        // We will cleanup based on the directory of the file later.
        return finalOut
      })()
    } catch (e) {
      log.error('[ExportManager] Error preparing processed audio:', e)
      processedAudioPath = null
    }

    if (processedAudioPath) {
      ffmpegArgs.push('-i', processedAudioPath)
    } else {
      ffmpegArgs.push('-i', projectState.audioPath)
    }
  }

  // --- Hardware acceleration auto-detect with real encoder check ---
  // --- Detect GPU type for encoder selection (Windows only) ---
  if (isMp4) {
    // Renderer already encoded the video to H.264 using hardware acceleration (WebCodecs)
    // We just copy the video stream and mux it with audio.
    // Use setts bitstream filter to generate monotonic timestamps (PTS=DTS=N) since raw stream lacks them
    ffmpegArgs.push('-c:v', 'copy', '-bsf:v', 'setts=dts=N:pts=N')
    log.info('[ExportManager] Using video stream copy (Renderer pre-encoded)')

    // If audio present
    if (projectState.audioPath) {
      // Use input #1 (audio) which is either processed or original
      ffmpegArgs.push('-map', '0:v:0', '-map', '1:a:0', '-c:a', 'aac', '-shortest')
    }
  } else {
    ffmpegArgs.push('-vf', 'split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse')
  }
  ffmpegArgs.push(outputPath)

  log.info('[ExportManager] Spawning FFmpeg with args:', ffmpegArgs.join(' '))
  const ffmpeg = spawn(FFMPEG_PATH, ffmpegArgs)
  if (typeof ffmpeg.pid === 'number') {
    trySetProcessPriorityWithFallback(ffmpeg.pid, targetPriorityCandidates, 'ffmpeg')
  }

  ffmpeg.stderr.on('data', (data) => log.info(`[FFmpeg stderr]: ${data.toString()}`))

  const cleanupProcessedAudio = () => {
    try {
      if (processedAudioPath) {
        const tmpDir = path.dirname(processedAudioPath)
        if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    } catch (err) {
      log.error('[ExportManager] Failed to cleanup processed audio temp:', err)
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const frameListener = (_e: any, { frame, progress }: { frame: Buffer; progress: number }) => {
    if (!ffmpegClosed && ffmpeg.stdin.writable) ffmpeg.stdin.write(frame)
    sendProgressUpdate(progress, 'Rendering...')
  }

  const finishListener = () => {
    log.info('[ExportManager] Render finished. Closing FFmpeg stdin.')
    const finalizingProgress = lastProgressBroadcast < 0 ? 0 : Math.max(lastProgressBroadcast, 99)
    sendProgressUpdate(finalizingProgress, 'Finalizing export...', true)
    if (!ffmpegClosed && ffmpeg.stdin.writable) {
      ffmpeg.stdin.end()
    }
  }

  const cleanupListeners = () => {
    ipcMain.removeListener('export:frame-data', frameListener)
    ipcMain.removeListener('export:render-finished', finishListener)
    ipcMain.removeListener('export:cancel', cancellationHandler)
    ipcMain.removeListener('export:render-error', renderErrorListener)
  }

  cancellationHandler = () => {
    if (exportCompleted) return

    log.warn('[ExportManager] Received "export:cancel". Terminating export.')
    exportCompleted = true

    if (ffmpeg && !ffmpeg.killed) {
      ffmpeg.kill('SIGKILL')
    }
    if (appState.renderWorker && !appState.renderWorker.isDestroyed()) {
      appState.renderWorker.close()
    }
    appState.renderWorker = null

    sendExportComplete({ success: false, error: 'Export cancelled.', duration: getElapsedDurationSeconds() }, 'cancelled')
    cleanupExportUi()

    if (fs.existsSync(outputPath)) {
      fsPromises.unlink(outputPath).catch((err) => log.error('Failed to delete cancelled export file:', err))
    }

    cleanupProcessedAudio()
    cleanupListeners()
  }

  const renderErrorListener = (_e: unknown, { error }: { error: string }) => {
    if (exportCompleted) return

    log.error('[ExportManager] Render error:', error)
    exportCompleted = true
    if (ffmpeg && !ffmpeg.killed) {
      ffmpeg.kill('SIGKILL')
    }
    if (appState.renderWorker && !appState.renderWorker.isDestroyed()) {
      appState.renderWorker.close()
    }
    appState.renderWorker = null

    sendExportComplete({ success: false, error, duration: getElapsedDurationSeconds() }, 'error')
    cleanupExportUi()
    cleanupProcessedAudio()
    cleanupListeners()
  }

  ipcMain.on('export:frame-data', frameListener)
  ipcMain.on('export:render-finished', finishListener)
  ipcMain.on('export:render-error', renderErrorListener)
  ipcMain.once('export:cancel', cancellationHandler) // Use once to avoid multiple calls

  ffmpeg.on('close', (code) => {
    ffmpegClosed = true
    log.info(`[ExportManager] FFmpeg process exited with code ${code}.`)

    cleanupProcessedAudio()

    if (appState.renderWorker && !appState.renderWorker.isDestroyed()) {
      appState.renderWorker.close()
    }
    appState.renderWorker = null

    if (!exportCompleted) {
      exportCompleted = true
      const renderDuration = getElapsedDurationSeconds()
      if (code === null) {
        sendExportComplete({ success: false, error: 'Export cancelled.', duration: renderDuration }, 'cancelled')
      } else if (code === 0) {
        log.info(`[ExportManager] Export completed successfully in ${renderDuration.toFixed(2)} seconds.`)
        sendProgressUpdate(100, 'Export completed', true)
        sendExportComplete({ success: true, outputPath, duration: renderDuration }, 'success')
      } else {
        sendExportComplete({ success: false, error: `FFmpeg exited with code ${code}`, duration: renderDuration }, 'error')
      }
    }

    cleanupExportUi()
    cleanupListeners()
  })

  ipcMain.once('render:ready', () => {
    log.info('[ExportManager] Worker ready. Sending project state.')
    showExportProgressWindow()
    createExportTray()
    sendProgressUpdate(0, 'Preparing export...', true)
    if (!editorWindow.isDestroyed()) {
      editorWindow.setSkipTaskbar(true)
      editorWindow.hide()
    }
    if (appState.renderWorker && !appState.renderWorker.isDestroyed()) {
      appState.renderWorker.webContents.send('render:start', { projectState, exportSettings: normalizedExportSettings })
    }
  })
}
