// Uses window.tempAPI exposed by electron/temp-preload.ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
/* eslint-env browser */

const progressFillEl = document.getElementById('progress-fill')
const progressInlineTextEl = document.getElementById('progress-inline-text')
const minimizeButtonEl = document.getElementById('minimize-btn')
const collapseButtonEl = document.getElementById('collapse-btn')
const windowEl = document.querySelector('.window')
const progressTrackEl = document.querySelector('.progress-track')

/** @type {any} */
const tempAPI = (window).tempAPI
if (!tempAPI) {
  console.error('[ExportProgress] window.tempAPI is missing. Progress IPC bridge is not available.')
}

let isFinished = false
let mediaThemeQuery = null
let mediaThemeListener = null
let isCollapsed = false
let lastRenderedProgress = 0
let lastAppliedProgressLogBucket = -1
let lastPolledProgressLogBucket = -1
let lastPushedProgressLogBucket = -1
let pollCount = 0
let progressPollTimer = null

const logProgressDiagnostic = (message, payload) => {
  if (typeof payload === 'undefined') {
    console.info(`[ExportProgress] ${message}`)
    return
  }
  console.info(`[ExportProgress] ${message}`, payload)
}

const getProgressLogBucket = (progress) => Math.floor(clampProgress(progress) / 5)

const shouldLogProgress = (progress, lastBucket) => {
  const bucket = getProgressLogBucket(progress)
  return {
    bucket,
    shouldLog: bucket !== lastBucket || progress >= 99 || progress <= 0,
  }
}

const applyThemeClass = (resolvedTheme) => {
  const nextTheme = resolvedTheme === 'dark' ? 'dark' : 'light'
  document.documentElement.classList.remove('theme-light', 'theme-dark')
  document.documentElement.classList.add(`theme-${nextTheme}`)
}

const resolveThemeValue = (modeValue) => {
  if (modeValue === 'dark' || modeValue === 'light' || modeValue === 'auto' || modeValue === 'system') {
    return modeValue
  }
  return 'system'
}

const setupTheme = async () => {
  let appearanceMode = 'system'

  try {
    const rawModeFromSetting = await tempAPI.invoke('settings:get', 'appearance.mode')
    if (
      rawModeFromSetting === 'light' ||
      rawModeFromSetting === 'dark' ||
      rawModeFromSetting === 'auto' ||
      rawModeFromSetting === 'system'
    ) {
      appearanceMode = rawModeFromSetting
    } else {
      const appearanceObj = await tempAPI.invoke('settings:get', 'appearance')
      if (appearanceObj && typeof appearanceObj.mode === 'string') {
        appearanceMode = resolveThemeValue(appearanceObj.mode)
      }
    }
  } catch (error) {
    console.error('Failed to read appearance settings for export progress window:', error)
  }

  if (mediaThemeQuery && mediaThemeListener) {
    if (typeof mediaThemeQuery.removeEventListener === 'function') {
      mediaThemeQuery.removeEventListener('change', mediaThemeListener)
    } else if (typeof mediaThemeQuery.removeListener === 'function') {
      mediaThemeQuery.removeListener(mediaThemeListener)
    }
  }

  if (appearanceMode === 'auto' || appearanceMode === 'system') {
    mediaThemeQuery = window.matchMedia('(prefers-color-scheme: dark)')
    mediaThemeListener = (event) => {
      applyThemeClass(event.matches ? 'dark' : 'light')
    }
    if (typeof mediaThemeQuery.addEventListener === 'function') {
      mediaThemeQuery.addEventListener('change', mediaThemeListener)
    } else if (typeof mediaThemeQuery.addListener === 'function') {
      mediaThemeQuery.addListener(mediaThemeListener)
    }
    applyThemeClass(mediaThemeQuery.matches ? 'dark' : 'light')
    return
  }

  mediaThemeQuery = null
  mediaThemeListener = null
  applyThemeClass(appearanceMode)
}

const clampProgress = (progress) => {
  if (!Number.isFinite(progress)) return 0
  return Math.max(0, Math.min(100, progress))
}

const applyProgress = (progress, stage, source = 'unknown') => {
  const safeProgress = Math.max(lastRenderedProgress, clampProgress(progress))
  lastRenderedProgress = safeProgress
  progressFillEl.style.transform = `scaleX(${safeProgress / 100})`
  const stageText = typeof stage === 'string' && stage.trim().length > 0 ? stage.trim() : 'Rendering'
  progressInlineTextEl.textContent = `${stageText} ${Math.round(safeProgress)}%`
  progressTrackEl?.setAttribute('aria-valuenow', `${Math.round(safeProgress)}`)

  const progressLog = shouldLogProgress(safeProgress, lastAppliedProgressLogBucket)
  if (progressLog.shouldLog) {
    lastAppliedProgressLogBucket = progressLog.bucket
    logProgressDiagnostic('Applied progress to DOM.', {
      source,
      progress: Number(safeProgress.toFixed(2)),
      stage: stageText,
      text: progressInlineTextEl.textContent,
      fillTransform: progressFillEl.style.transform,
    })
  }
}

const readLatestProgress = async () => {
  if (isFinished || !tempAPI?.invoke) return
  pollCount += 1
  try {
    const payload = await tempAPI.invoke('export-progress:get-state')
    if (!payload) {
      if (pollCount === 1 || pollCount % 20 === 0) {
        logProgressDiagnostic('Polled progress state but main returned null.', { pollCount })
      }
      return
    }
    const progressLog = shouldLogProgress(payload.progress, lastPolledProgressLogBucket)
    if (progressLog.shouldLog) {
      lastPolledProgressLogBucket = progressLog.bucket
      logProgressDiagnostic('Polled progress state from main.', {
        pollCount,
        progress: Number(clampProgress(payload.progress).toFixed(2)),
        stage: payload.stage || 'Rendering...',
      })
    }
    applyProgress(payload.progress, payload.stage || 'Rendering...', 'poll')
  } catch (error) {
    console.error('[ExportProgress] Failed to poll export progress state:', error)
  }
}

const applyCollapsedVisualState = (collapsed) => {
  isCollapsed = collapsed
  windowEl?.classList.toggle('is-collapsed', collapsed)
  if (collapseButtonEl) {
    collapseButtonEl.textContent = collapsed ? '<' : '>'
    collapseButtonEl.setAttribute(
      'aria-label',
      collapsed ? 'Expand progress widget' : 'Collapse progress widget',
    )
  }
}

minimizeButtonEl?.addEventListener('click', () => {
  if (isFinished) return
  const shouldMinimize = window.confirm(
    'Minimizar pode aumentar o tempo de renderizacao. Deseja minimizar mesmo assim?',
  )
  if (!shouldMinimize) {
    return
  }
  tempAPI?.send?.('window:minimize')
})

collapseButtonEl?.addEventListener('click', () => {
  const nextCollapsed = !isCollapsed
  applyCollapsedVisualState(nextCollapsed)
  tempAPI?.send?.('export-progress:set-collapsed', { collapsed: nextCollapsed })
})

const cleanupExportProgress = tempAPI?.on?.('export:progress', (payload) => {
  if (!payload) return
  const progressLog = shouldLogProgress(payload.progress, lastPushedProgressLogBucket)
  if (progressLog.shouldLog) {
    lastPushedProgressLogBucket = progressLog.bucket
    logProgressDiagnostic('Received export:progress push event.', {
      progress: Number(clampProgress(payload.progress).toFixed(2)),
      stage: payload.stage || 'Rendering...',
    })
  }
  applyProgress(payload.progress, payload.stage || 'Rendering...', 'push')
})

const cleanupExportComplete = tempAPI?.on?.('export:complete', (payload) => {
  isFinished = true
  logProgressDiagnostic('Received export:complete event.', payload)

  if (payload?.success) {
    applyProgress(100, 'Export completed', 'complete')
    minimizeButtonEl.disabled = true
    return
  }

  const errorText = payload?.error ? `Export stopped: ${payload.error}` : 'Export stopped'
  progressInlineTextEl.textContent = errorText
  progressFillEl.style.transform = 'scaleX(1)'
  minimizeButtonEl.disabled = true
})

void setupTheme()
logProgressDiagnostic('Script booted.', {
  hasTempAPI: Boolean(tempAPI),
  hasInvoke: Boolean(tempAPI?.invoke),
  hasOn: Boolean(tempAPI?.on),
  hasProgressFill: Boolean(progressFillEl),
  hasProgressText: Boolean(progressInlineTextEl),
  hasProgressTrack: Boolean(progressTrackEl),
})
applyCollapsedVisualState(false)
void readLatestProgress()
progressPollTimer = window.setInterval(readLatestProgress, 250)
logProgressDiagnostic('Started progress polling interval.', { intervalMs: 250 })

window.addEventListener('beforeunload', () => {
  logProgressDiagnostic('Window unloading. Cleaning listeners and polling interval.')
  if (progressPollTimer) window.clearInterval(progressPollTimer)
  if (typeof cleanupExportProgress === 'function') cleanupExportProgress()
  if (typeof cleanupExportComplete === 'function') cleanupExportComplete()
  if (mediaThemeQuery && mediaThemeListener) {
    if (typeof mediaThemeQuery.removeEventListener === 'function') {
      mediaThemeQuery.removeEventListener('change', mediaThemeListener)
    } else if (typeof mediaThemeQuery.removeListener === 'function') {
      mediaThemeQuery.removeListener(mediaThemeListener)
    }
  }
})
