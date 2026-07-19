/* eslint-disable @typescript-eslint/no-explicit-any */
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import type { ScreenEncoderStatus } from '../src/types/screen-encoder'

// Define the type for the callback value
type RecordingResult = {
  canceled: boolean
  filePath: string | undefined
}

type ProjectPayload = {
  videoPath: string
  metadataPath: string
  webcamVideoPath?: string
  audioPath?: string
  systemAudioPath?: string
  originalProjectPath?: string
}

let latestProjectPayload: ProjectPayload | null = null
const projectPayloadListeners = new Set<(payload: ProjectPayload) => void>()

ipcRenderer.on('project:open', (_event: IpcRendererEvent, payload: ProjectPayload) => {
  latestProjectPayload = payload
  projectPayloadListeners.forEach((listener) => listener(payload))
})

type ExportPayload = {
  projectState: any
  exportSettings: any
  outputPath: string
}
type SourceVideoInfo = {
  width: number
  height: number
  fps: number | null
  averageFps: number | null
  nominalFps: number | null
}
type SystemMemoryInfo = {
  totalMemoryBytes: number
}
type CurrentProcessMemoryInfo = {
  private: number
  residentSet?: number
  shared: number
}

type MediaImportResult = {
  canceled: boolean
  asset?: {
    path: string
    name: string
  }
}
type FileStatResult = {
  size: number
  isFile: boolean
}
type ReadFileChunkPayload = {
  filePath: string
  offset: number
  length: number
}
type FolderNameValidationResult = {
  valid: boolean
  normalizedName?: string
  error?: string
}
type ResolveProjectFolderResult = {
  success: boolean
  targetFolder?: string
  normalizedName?: string
  error?: string
}
type ResolveExportOutputPathResult = {
  success: boolean
  outputPath?: string
  error?: string
}
type SavedProjectListItem = {
  name: string
  folderPath: string
  projectFilePath: string
  thumbnailPath?: string
  thumbnailUrl?: string
  recordedAt: string
  sizeBytes: number
  isLegacy: boolean
}
type ListSavedProjectsResult = {
  success: boolean
  rootPath?: string
  projects?: SavedProjectListItem[]
  error?: string
}
type SaveProjectOptions = {
  thumbnailSourcePath?: string | null
  thumbnailTimeSeconds?: number | null
  confirmReplaceExisting?: boolean
}
type SaveProjectResult = {
  success: boolean
  canceled?: boolean
  error?: string
}
// Payload received from process
type ProgressPayload = {
  progress: number // 0-100
  stage: string
  exportSessionId?: string
}
// Payload when completed
type CompletePayload = {
  success: boolean
  outputPath?: string
  error?: string
  duration?: number
}

let lastPreloadRenderProgressLogBucket = -1

// Payload for worker render
type RenderStartPayload = {
  projectState: any
  exportSettings: any
  exportSessionId?: string
}

type WindowSource = {
  id: string
  name: string
  thumbnailUrl: string
  geometry?: {
    x: number
    y: number
    width: number
    height: number
  }
}

// --- Presets ---
type Preset = any

type DisplayInfo = {
  id: number
  name: string
  bounds: { x: number; y: number; width: number; height: number }
  isPrimary: boolean
}

// --- Update ---
type UpdateInfo = {
  version: string
  url: string
}

// --- Dshow Devices ---
type DshowDevice = {
  name: string
  alternativeName: string
}

type AuthUser = {
  email: string
  name: string | null
  picture: string | null
}

type AuthLicense = {
  active: boolean
  plan: string | null
  region: string | null
  activatedAt: string | null
  subscriptionStatus: string | null
  licenseValidUntil: string | null
  paidAmount: number | null
  paidCurrency: string | null
  watermarkRequired: boolean
}

type AuthCredits = {
  visible: boolean
  balanceUnits: number
  balanceCredits: number
  monthlyGrantUnits: number
  month: string
}

type AuthSession = {
  user: AuthUser | null
  license: AuthLicense | null
  credits: AuthCredits | null
  sessionToken: string | null
  entitlementToken: string | null
  isAuthenticated: boolean
  status: 'active' | 'canceled' | 'free'
}

type AuthDeepLinkPayload = {
  status: 'success' | 'error'
  code?: string
  error?: string
  rawUrl: string
}

// --- Cursor Theme ---
type CursorTheme = any

// Define API to be exposed to window object
export const electronAPI = {
  // --- Recording ---
  startRecording: (options: {
    source: 'area' | 'fullscreen' | 'window'
    geometry?: WindowSource['geometry']
    windowTitle?: string
    displayId?: number
    webcam?: { deviceId: string; deviceLabel: string; index: number }
    mic?: { deviceId: string; deviceLabel: string; index: number }
    computerAudioEnabled?: boolean
    computerAudioDeviceId?: string
    recordingProfile?: unknown
  }): Promise<RecordingResult> => ipcRenderer.invoke('recording:start', options),
  selectRecordingArea: (): Promise<WindowSource['geometry'] | undefined> => ipcRenderer.invoke('recording:select-area'),
  getComputerAudioSupport: (): Promise<{ supported: boolean; reason?: string }> =>
    ipcRenderer.invoke('recording:get-computer-audio-support'),
  stopRecording: (): void => ipcRenderer.send('recording:stop'),
  loadVideoFromFile: (): Promise<RecordingResult> => ipcRenderer.invoke('recording:load-from-file'),
  importProject: (): Promise<RecordingResult> => ipcRenderer.invoke('recording:import-project'),
  importProjectFile: (projectFilePath: string): Promise<RecordingResult> =>
    ipcRenderer.invoke('recording:import-project-file', projectFilePath),
  importMediaAudioAsset: (): Promise<MediaImportResult> => ipcRenderer.invoke('media:import-audio'),
  importMediaVideoAsset: (): Promise<MediaImportResult> => ipcRenderer.invoke('media:import-video'),
  importMediaImageAsset: (): Promise<MediaImportResult> => ipcRenderer.invoke('media:import-image'),
  getCursorScale: (): Promise<number> => ipcRenderer.invoke('desktop:get-cursor-scale'),
  setCursorScale: (scale: number): void => ipcRenderer.send('desktop:set-cursor-scale', scale),

  getDisplays: (): Promise<DisplayInfo[]> => ipcRenderer.invoke('desktop:get-displays'),
  getDshowDevices: (): Promise<{ video: DshowDevice[]; audio: DshowDevice[] }> =>
    ipcRenderer.invoke('desktop:get-dshow-devices'),
  getWindowsAudioDevices: (): Promise<{ id: string; name: string; isDefault: boolean; sampleRate: number; channels: number; bitsPerSample: number; sampleFormat: string }[]> =>
    ipcRenderer.invoke('desktop:get-windows-audio-devices'),
  analyzeRecordingCapability: (): Promise<{
    recommendedFps: 30 | 60
    canRecord60Fps: boolean
    reason: string
    measuredFps?: number
  }> => ipcRenderer.invoke('recording:analyze-capability'),
  getScreenEncoderStatus: (refresh = false): Promise<ScreenEncoderStatus> =>
    ipcRenderer.invoke('recording:get-screen-encoder-status', refresh),

  onRecordingStarted: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('recording-started', listener)
    return () => {
      ipcRenderer.removeListener('recording-started', listener)
    }
  },

  onRecordingFinished: (callback: (result: RecordingResult) => void) => {
    const listener = (_event: IpcRendererEvent, result: RecordingResult) => callback(result)
    ipcRenderer.on('recording-finished', listener)

    return () => {
      ipcRenderer.removeListener('recording-finished', listener)
    }
  },
  onReleaseWebcamRequest: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('recorder:release-webcam', listener)
    return () => {
      ipcRenderer.removeListener('recorder:release-webcam', listener)
    }
  },
  sendWebcamReleasedConfirmation: () => ipcRenderer.send('recorder:webcam-released'),

  // --- Editor window ---
  onProjectOpen: (callback: (payload: ProjectPayload) => void) => {
    projectPayloadListeners.add(callback)
    if (latestProjectPayload) {
      queueMicrotask(() => {
        if (latestProjectPayload && projectPayloadListeners.has(callback)) {
          callback(latestProjectPayload)
        }
      })
    }

    return () => {
      projectPayloadListeners.delete(callback)
    }
  },
  editorReadyForProject: (): void => ipcRenderer.send('editor:ready-for-project'),

  readFile: (filePath: string): Promise<string> => ipcRenderer.invoke('fs:readFile', filePath),
  readFileBuffer: (filePath: string): Promise<Uint8Array> => ipcRenderer.invoke('fs:readFileBuffer', filePath),
  statFile: (filePath: string): Promise<FileStatResult> => ipcRenderer.invoke('fs:statFile', filePath),
  readFileChunk: (payload: ReadFileChunkPayload): Promise<Uint8Array> =>
    ipcRenderer.invoke('fs:readFileChunk', payload),
  getRecordSaaSRootPath: (): Promise<string> => ipcRenderer.invoke('fs:getRecordSaaSRootPath'),
  getDefaultRecordSaaSRootPath: (): Promise<string> => ipcRenderer.invoke('fs:getDefaultRecordSaaSRootPath'),
  listSavedProjects: (): Promise<ListSavedProjectsResult> => ipcRenderer.invoke('fs:listSavedProjects'),
  validateProjectFolderName: (projectName: string): Promise<FolderNameValidationResult> =>
    ipcRenderer.invoke('fs:validateProjectFolderName', projectName),
  resolveProjectFolder: (projectName: string): Promise<ResolveProjectFolderResult> =>
    ipcRenderer.invoke('fs:resolveProjectFolder', projectName),
  resolveExportOutputPath: (payload: {
    projectFolder?: string | null
    filename: string
  }): Promise<ResolveExportOutputPathResult> => ipcRenderer.invoke('fs:resolveExportOutputPath', payload),

  // --- Export ---
  startExport: (payload: ExportPayload): Promise<void> => ipcRenderer.invoke('export:start', payload),
  probeExportSourceVideoInfo: (videoPath: string | null | undefined): Promise<SourceVideoInfo | null> =>
    ipcRenderer.invoke('export:probe-source-video-info', videoPath),
  cancelExport: (): void => ipcRenderer.send('export:cancel'),

  onExportProgress: (callback: (payload: ProgressPayload) => void) => {
    const listener = (_event: IpcRendererEvent, payload: ProgressPayload) => callback(payload)
    ipcRenderer.on('export:progress', listener)
    return () => {
      ipcRenderer.removeListener('export:progress', listener)
    }
  },

  onExportComplete: (callback: (payload: CompletePayload) => void) => {
    const listener = (_event: IpcRendererEvent, payload: CompletePayload) => callback(payload)
    ipcRenderer.on('export:complete', listener)
    return () => {
      ipcRenderer.removeListener('export:complete', listener)
    }
  },

  showSaveDialog: (options: Electron.SaveDialogOptions): Promise<Electron.SaveDialogReturnValue> => {
    return ipcRenderer.invoke('dialog:showSaveDialog', options)
  },

  showOpenDialog: (options: Electron.OpenDialogOptions): Promise<Electron.OpenDialogReturnValue> => {
    return ipcRenderer.invoke('dialog:showOpenDialog', options)
  },

  saveProject: (
    targetFolder: string,
    projectData: string,
    mediaFiles: string[],
    options: SaveProjectOptions = {},
  ): Promise<SaveProjectResult> => {
    return ipcRenderer.invoke('fs:saveProject', { targetFolder, projectData, mediaFiles, ...options })
  },

  showItemInFolder: (path: string): void => ipcRenderer.send('shell:showItemInFolder', path),

  onUpdateAvailable: (callback: (info: UpdateInfo) => void) => {
    const listener = (_event: IpcRendererEvent, info: UpdateInfo) => callback(info)
    ipcRenderer.on('update:available', listener)
    return () => {
      ipcRenderer.removeListener('update:available', listener)
    }
  },
  openExternal: (url: string): void => ipcRenderer.send('shell:openExternal', url),
  getAuthSession: (): Promise<AuthSession> => ipcRenderer.invoke('auth:get-session'),
  getSystemMemoryInfo: (): Promise<SystemMemoryInfo> => ipcRenderer.invoke('app:getSystemMemoryInfo'),
  getCurrentProcessMemoryInfo: (): Promise<CurrentProcessMemoryInfo> => process.getProcessMemoryInfo(),
  startAuthLogin: (): Promise<{ success: boolean }> => ipcRenderer.invoke('auth:start-login'),
  logoutAuth: (): Promise<AuthSession> => ipcRenderer.invoke('auth:logout'),
  onAuthDeepLink: (callback: (payload: AuthDeepLinkPayload) => void) => {
    const listener = (_event: IpcRendererEvent, payload: AuthDeepLinkPayload) => callback(payload)
    ipcRenderer.on('auth:deeplink', listener)
    return () => {
      ipcRenderer.removeListener('auth:deeplink', listener)
    }
  },
  onAuthSessionUpdated: (callback: (payload: AuthSession) => void) => {
    const listener = (_event: IpcRendererEvent, payload: AuthSession) => callback(payload)
    ipcRenderer.on('auth:session-updated', listener)
    return () => {
      ipcRenderer.removeListener('auth:session-updated', listener)
    }
  },

  // --- Render Worker ---
  onRenderStart: (callback: (payload: RenderStartPayload) => void) => {
    const listener = (_event: IpcRendererEvent, payload: RenderStartPayload) => callback(payload)
    ipcRenderer.on('render:start', listener)
    return () => {
      ipcRenderer.removeListener('render:start', listener)
    }
  },
  rendererReady: () => {
    ipcRenderer.send('render:ready')
  },
  sendFrameToMain: (payload: { frame: Buffer; progress: number }) => {
    ipcRenderer.send('export:frame-data', payload)
  },
  sendRenderProgress: (payload: { progress: number }) => {
    const safeProgress = Math.max(0, Math.min(100, Number.isFinite(payload.progress) ? payload.progress : 0))
    const bucket = Math.floor(safeProgress / 5)
    if (bucket !== lastPreloadRenderProgressLogBucket) {
      lastPreloadRenderProgressLogBucket = bucket
      console.info(`[Preload][Progress] Sending export:render-progress ${safeProgress.toFixed(2)}%.`)
    }
    ipcRenderer.send('export:render-progress', payload)
  },
  finishRender: () => {
    ipcRenderer.send('export:render-finished')
  },
  sendRenderError: (payload: { error: string }) => {
    ipcRenderer.send('export:render-error', payload)
  },

  // --- Presets & Settings ---
  loadPresets: (): Promise<Record<string, Preset>> => ipcRenderer.invoke('presets:load'),
  savePresets: (presets: Record<string, Preset>): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('presets:save', presets),
  getSetting: <T = any>(key: string): Promise<T> => ipcRenderer.invoke('settings:get', key),
  setSetting: (key: string, value: unknown): void => ipcRenderer.send('settings:set', key, value),
  getPath: (name: 'home' | 'userData' | 'desktop' | 'documents'): Promise<string> =>
    ipcRenderer.invoke('app:getPath', name),
  getCursorThemes: (): Promise<string[]> => ipcRenderer.invoke('desktop:get-cursor-themes'),
  loadCursorTheme: (themeName?: string): Promise<CursorTheme | null> =>
    ipcRenderer.invoke('desktop:load-cursor-theme', themeName),
  mapCursorNameToIDC: (name: string): Promise<string> => ipcRenderer.invoke('desktop:map-cursor-name-to-idc', name),

  // --- Window Controls ---
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  maximizeWindow: () => ipcRenderer.send('window:maximize'),
  closeWindow: () => ipcRenderer.send('window:close'),
  openRecorder: () => ipcRenderer.send('window:open-recorder'),
  recorderClickThrough: () => ipcRenderer.send('recorder:click-through'),
  setRecorderIgnoreMouse: (ignore: boolean) => ipcRenderer.send('recorder:set-ignore', ignore),
  setRecorderWindowSize: (size: { width: number; height: number }) => ipcRenderer.send('recorder:set-size', size),
  windowIsMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:isMaximized'),
  onWindowStateChange: (callback: (payload: { isMaximized: boolean }) => void) => {
    const listener = (_event: IpcRendererEvent, payload: { isMaximized: boolean }) => callback(payload)
    ipcRenderer.on('window:state-changed', listener)
    return () => {
      ipcRenderer.removeListener('window:state-changed', listener)
    }
  },
  // --- START OF CHANGES ---
  updateTitleBarOverlay: (options: { color: string; symbolColor: string }) => {
    ipcRenderer.send('window:update-title-bar-overlay', options)
  },
  // --- END OF CHANGES ---
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:getVersion'),
  getPlatform: (): Promise<NodeJS.Platform> => ipcRenderer.invoke('app:getPlatform'),
  getVideoFrame: (options: { videoPath: string; time: number }): Promise<string> =>
    ipcRenderer.invoke('video:get-frame', options),
}

// Expose API safely
contextBridge.exposeInMainWorld('electronAPI', electronAPI)

// Also need to define types for TypeScript in renderer
declare global {
  interface Window {
    electronAPI: typeof electronAPI
  }
}
