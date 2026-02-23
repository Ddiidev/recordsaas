const { ipcRenderer } = require('electron')

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

const applyThemeClass = (resolvedTheme) => {
  const nextTheme = resolvedTheme === 'dark' ? 'dark' : 'light'
  document.documentElement.classList.remove('theme-light', 'theme-dark')
  document.documentElement.classList.add(`theme-${nextTheme}`)
}

const resolveThemeValue = (modeValue) => {
  if (modeValue === 'dark' || modeValue === 'light' || modeValue === 'auto') {
    return modeValue
  }
  return 'light'
}

const setupTheme = async () => {
  let appearanceMode = 'light'

  try {
    const rawModeFromSetting = await ipcRenderer.invoke('settings:get', 'appearance.mode')
    if (rawModeFromSetting === 'light' || rawModeFromSetting === 'dark' || rawModeFromSetting === 'auto') {
      appearanceMode = rawModeFromSetting
    } else {
      const appearanceObj = await ipcRenderer.invoke('settings:get', 'appearance')
      if (appearanceObj && typeof appearanceObj.mode === 'string') {
        appearanceMode = resolveThemeValue(appearanceObj.mode)
      }
    }
  } catch (error) {
    console.error('Failed to read appearance settings for export progress window:', error)
  }

  if (mediaThemeQuery && mediaThemeListener) {
    mediaThemeQuery.removeEventListener('change', mediaThemeListener)
  }

  if (appearanceMode === 'auto') {
    mediaThemeQuery = window.matchMedia('(prefers-color-scheme: dark)')
    mediaThemeListener = (event) => {
      applyThemeClass(event.matches ? 'dark' : 'light')
    }
    mediaThemeQuery.addEventListener('change', mediaThemeListener)
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
  const safeProgress = clampProgress(progress)
  progressFillEl.style.width = `${safeProgress}%`
  progressInlineTextEl.textContent = `Rendering ${Math.round(safeProgress)}%`
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
  ipcRenderer.send('window:minimize')
})

collapseButtonEl?.addEventListener('click', () => {
  const nextCollapsed = !isCollapsed
  applyCollapsedVisualState(nextCollapsed)
  ipcRenderer.send('export-progress:set-collapsed', { collapsed: nextCollapsed })
})

ipcRenderer.on('export:progress', (_event, payload) => {
  if (!payload) return
  applyProgress(payload.progress, payload.stage || 'Rendering...')
})

ipcRenderer.on('export:complete', (_event, payload) => {
  isFinished = true

  if (payload?.success) {
    applyProgress(100, 'Export completed')
    minimizeButtonEl.disabled = true
    return
  }

  const errorText = payload?.error ? `Export stopped: ${payload.error}` : 'Export stopped'
  statusTextEl.textContent = errorText.toLowerCase()
  minimizeButtonEl.disabled = true
})

void setupTheme()
applyCollapsedVisualState(false)

window.addEventListener('beforeunload', () => {
  ipcRenderer.removeAllListeners('export:progress')
  ipcRenderer.removeAllListeners('export:complete')
  if (mediaThemeQuery && mediaThemeListener) {
    mediaThemeQuery.removeEventListener('change', mediaThemeListener)
  }
})
