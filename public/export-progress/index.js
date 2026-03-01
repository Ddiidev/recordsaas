const progressFillEl = document.getElementById('progress-fill')
const progressInlineTextEl = document.getElementById('progress-inline-text')
const minimizeButtonEl = document.getElementById('minimize-btn')
const collapseButtonEl = document.getElementById('collapse-btn')
const windowEl = document.querySelector('.window')
const progressTrackEl = document.querySelector('.progress-track')

let isFinished = false
let mediaThemeQuery = null
let mediaThemeListener = null
let isCollapsed = false
let lastRenderedProgress = 0

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
    const rawModeFromSetting = await window.overlayAPI.invoke('settings:get', 'appearance.mode')
    if (
      rawModeFromSetting === 'light' ||
      rawModeFromSetting === 'dark' ||
      rawModeFromSetting === 'auto' ||
      rawModeFromSetting === 'system'
    ) {
      appearanceMode = rawModeFromSetting
    } else {
      const appearanceObj = await window.overlayAPI.invoke('settings:get', 'appearance')
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

const applyProgress = (progress, stage) => {
  const safeProgress = Math.max(lastRenderedProgress, clampProgress(progress))
  lastRenderedProgress = safeProgress
  progressFillEl.style.transform = `scaleX(${safeProgress / 100})`
  const stageText = typeof stage === 'string' && stage.trim().length > 0 ? stage.trim() : 'Rendering'
  progressInlineTextEl.textContent = `${stageText} ${Math.round(safeProgress)}%`
  progressTrackEl?.setAttribute('aria-valuenow', `${Math.round(safeProgress)}`)
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
  window.overlayAPI.send('window:minimize')
})

collapseButtonEl?.addEventListener('click', () => {
  const nextCollapsed = !isCollapsed
  applyCollapsedVisualState(nextCollapsed)
  window.overlayAPI.send('export-progress:set-collapsed', { collapsed: nextCollapsed })
})

window.overlayAPI.on('export:progress', (payload) => {
  if (!payload) return
  applyProgress(payload.progress, payload.stage || 'Rendering...')
})

window.overlayAPI.on('export:complete', (payload) => {
  isFinished = true

  if (payload?.success) {
    applyProgress(100, 'Export completed')
    minimizeButtonEl.disabled = true
    return
  }

  const errorText = payload?.error ? `Export stopped: ${payload.error}` : 'Export stopped'
  progressInlineTextEl.textContent = errorText
  progressFillEl.style.transform = 'scaleX(1)'
  minimizeButtonEl.disabled = true
})

void setupTheme()
applyCollapsedVisualState(false)

window.addEventListener('beforeunload', () => {
  window.overlayAPI.removeAllListeners('export:progress')
  window.overlayAPI.removeAllListeners('export:complete')
  if (mediaThemeQuery && mediaThemeListener) {
    if (typeof mediaThemeQuery.removeEventListener === 'function') {
      mediaThemeQuery.removeEventListener('change', mediaThemeListener)
    } else if (typeof mediaThemeQuery.removeListener === 'function') {
      mediaThemeQuery.removeListener(mediaThemeListener)
    }
  }
})
