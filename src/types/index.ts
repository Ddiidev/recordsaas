// --- Types ---
export type BackgroundType = 'color' | 'gradient' | 'image' | 'wallpaper'
export type AspectRatio = '16:9' | '9:16' | '4:3' | '3:4' | '1:1'
export type SidePanelTab = 'general' | 'camera' | 'cursor' | 'audio' | 'animation' | 'settings'
export type AppearanceMode = 'light' | 'dark' | 'auto'

export interface Background {
  type: BackgroundType
  color?: string
  gradientStart?: string
  gradientEnd?: string
  gradientDirection?: string
  imageUrl?: string
  thumbnailUrl?: string
}

export interface FrameStyles {
  padding: number
  background: Background
  borderRadius: number
  shadowBlur: number
  shadowOffsetX: number
  shadowOffsetY: number
  shadowColor: string
  borderWidth: number
  borderColor: string
}

export interface CursorStyles {
  showCursor: boolean
  shadowBlur: number
  shadowOffsetX: number
  shadowOffsetY: number
  shadowColor: string
  // Click Effects
  clickRippleEffect: boolean
  clickRippleColor: string
  clickRippleSize: number
  clickRippleDuration: number
  clickScaleEffect: boolean
  clickScaleAmount: number
  clickScaleDuration: number
  clickScaleEasing: string
}

export interface Preset {
  id: string
  name: string
  styles: FrameStyles
  aspectRatio: AspectRatio
  isDefault?: boolean
  webcamStyles?: WebcamStyles
  webcamPosition?: WebcamPosition
  isWebcamVisible?: boolean
}

export interface TimelineLane {
  id: string
  name: string
  order: number
  visible: boolean
  locked: boolean
}

export interface ZoomRegion {
  id: string
  type: 'zoom'
  laneId: string
  startTime: number
  duration: number
  zoomLevel: number
  easing: string // Changed from 'linear' | 'ease-in-out'
  transitionDuration: number // New property for speed
  targetX: number
  targetY: number
  mode: 'auto' | 'fixed'
  zIndex: number
}

export interface CutRegion {
  id: string
  type: 'cut'
  laneId: string
  startTime: number
  duration: number
  trimType?: 'start' | 'end'
  zIndex: number
}

export interface SpeedRegion {
  id: string
  type: 'speed'
  laneId: string
  startTime: number
  duration: number
  speed: number // e.g., 1.5 for 1.5x speed
  zIndex: number
}

export type BlurRegionStyle = 'blur' | 'pixelated'

export interface BlurRegion {
  id: string
  type: 'blur'
  laneId: string
  startTime: number
  duration: number
  style: BlurRegionStyle
  intensity: number
  x: number
  y: number
  width: number
  height: number
  zIndex: number
}

export interface CameraSwapRegion {
  id: string
  type: 'swap'
  laneId: string
  startTime: number
  duration: number
  showDesktopOverlay: boolean
  transition: 'none' | 'fade' | 'slide' | 'scale'
  zIndex: number
  transitionDuration?: number
}

export type TimelineRegion = ZoomRegion | CutRegion | SpeedRegion | BlurRegion | CameraSwapRegion

export interface MetaDataItem {
  timestamp: number
  x: number
  y: number
  type: 'click' | 'move' | 'scroll'
  button?: string
  pressed?: boolean
  cursorImageKey?: string
}

export interface CursorFrame {
  width: number
  height: number
  xhot: number
  yhot: number
  delay: number
  rgba: Buffer
}

export interface CursorImageBase {
  width: number
  height: number
  xhot: number
  yhot: number
}

export interface CursorImage extends CursorImageBase {
  image: number[]
}

export interface CursorImageBitmap extends CursorImageBase {
  imageBitmap: ImageBitmap
}

export interface WebcamPosition {
  pos:
    | 'top-left'
    | 'top-center'
    | 'top-right'
    | 'bottom-left'
    | 'bottom-center'
    | 'bottom-right'
    | 'left-center'
    | 'right-center'
}

export type WebcamShape = 'circle' | 'square' | 'rectangle'

export interface WebcamStyles {
  shape: WebcamShape
  borderRadius: number
  size: number
  sizeOnZoom: number // нове поле для розміру під час zoom
  shadowBlur: number
  shadowOffsetX: number
  shadowOffsetY: number
  shadowColor: string
  isFlipped: boolean
  scaleOnZoom: boolean
  smartPosition: boolean
  border: boolean
  borderWidth: number
  borderColor: string
}

export type Dimensions = { width: number; height: number }
export type RecordingGeometry = { x: number; y: number; width: number; height: number }
export type VideoDimensions = Dimensions
export type ScreenSize = Dimensions
export type CursorTheme = Record<number, Record<string, CursorFrame[]>>

// --- Slice State & Actions Types ---

export interface ProjectState {
  videoPath: string | null
  metadataPath: string | null
  videoUrl: string | null
  micAudioPath: string | null
  micAudioUrl: string | null
  systemAudioPath: string | null
  systemAudioUrl: string | null
  // Legacy fields kept for compatibility with old persisted projects.
  audioPath: string | null
  audioUrl: string | null
  videoDimensions: VideoDimensions
  recordingGeometry: RecordingGeometry | null
  screenSize: ScreenSize | null
  canvasDimensions: Dimensions
  metadata: MetaDataItem[]
  duration: number
  cursorImages: Record<string, CursorImage>
  cursorBitmapsToRender: Map<string, CursorImageBitmap>
  syncOffset: number
  platform: NodeJS.Platform | null
  cursorTheme: CursorTheme | null
  hasMicAudioTrack: boolean
  hasSystemAudioTrack: boolean
  hasAnyAudioTrack: boolean
  // Legacy alias kept for compatibility with existing UI logic.
  hasAudioTrack: boolean
  originalProjectPath?: string
}

export interface ProjectActions {
  loadProject: (paths: {
    videoPath: string
    metadataPath: string
    webcamVideoPath?: string
    micAudioPath?: string
    systemAudioPath?: string
    audioPath?: string
    originalProjectPath?: string
  }) => Promise<void>
  setVideoDimensions: (dims: { width: number; height: number }) => void
  setDuration: (duration: number) => void
  resetProjectState: () => void
  setPostProcessingCursorScale: (scale: number) => Promise<void>
  reloadCursorTheme: (themeName: string) => Promise<void>
  setHasAudioTrack: (hasAudio: boolean) => void
  setOriginalProjectPath: (path: string) => void
}

export interface PlaybackState {
  isPlaying: boolean
  currentTime: number
}
export interface PlaybackActions {
  setCurrentTime: (time: number) => void
  setCurrentTimeThrottled: (time: number) => void
  togglePlay: () => void
  setPlaying: (isPlaying: boolean) => void
  seekToPreviousFrame: () => void
  seekToNextFrame: () => void
  seekBackward: (seconds: number) => void
  seekForward: (seconds: number) => void
}

export interface FrameState {
  frameStyles: FrameStyles
  aspectRatio: AspectRatio
}
export interface FrameActions {
  updateFrameStyle: (style: Partial<Omit<FrameStyles, 'background'>>) => void
  updateBackground: (bg: Partial<Background>) => void
  setAspectRatio: (ratio: AspectRatio) => void
}

export interface TimelineState {
  timelineLanes: TimelineLane[]
  zoomRegions: Record<string, ZoomRegion>
  cutRegions: Record<string, CutRegion>
  speedRegions: Record<string, SpeedRegion>
  blurRegions: Record<string, BlurRegion>
  swapRegions: Record<string, CameraSwapRegion>
  previewCutRegion: CutRegion | null
  selectedRegionId: string | null
  activeZoomRegionId: string | null
  isCurrentlyCut: boolean
  timelineZoom: number
}
export interface TimelineActions {
  addTimelineLane: () => void
  removeTimelineLane: (laneId: string) => void
  moveTimelineLane: (laneId: string, direction: 'up' | 'down') => void
  renameTimelineLane: (laneId: string, name: string) => void
  moveRegionToLane: (regionId: string, laneId: string) => void
  addZoomRegion: () => void
  addCutRegion: (regionData?: Partial<CutRegion>) => void
  addSpeedRegion: () => void
  addBlurRegion: () => void
  addSwapRegion: () => void
  updateRegion: (id: string, updates: Partial<TimelineRegion>) => void
  deleteRegion: (id: string) => void
  setSelectedRegionId: (id: string | null) => void
  setPreviewCutRegion: (region: CutRegion | null) => void
  setTimelineZoom: (zoom: number) => void
  applyAnimationSettingsToAll: (settings: { transitionDuration: number; easing: string; zoomLevel: number }) => void
  applySpeedToAll: (speed: number) => void
}

export interface PresetState {
  presets: Record<string, Preset>
  activePresetId: string | null
  presetSaveStatus: 'idle' | 'saving' | 'saved'
}
export interface PresetActions {
  initializePresets: () => Promise<void>
  applyPreset: (id: string) => void
  resetPreset: (id: string) => void
  updatePresetName: (id: string, name: string) => void
  saveCurrentStyleAsPreset: (name: string) => void
  updateActivePreset: () => void
  deletePreset: (id: string) => void
  _ensureActivePresetIsWritable: () => void
  _persistPresets: (presets: Record<string, Preset>) => Promise<void>
}

export interface WebcamState {
  webcamVideoPath: string | null
  webcamVideoUrl: string | null
  isWebcamVisible: boolean
  webcamPosition: WebcamPosition
  webcamStyles: WebcamStyles
}
export interface WebcamActions {
  setWebcamPosition: (position: WebcamPosition) => void
  setWebcamVisibility: (isVisible: boolean) => void
  updateWebcamStyle: (style: Partial<WebcamStyles>) => void
}

export interface UIState {
  mode: AppearanceMode
  isPreviewFullScreen: boolean
  cursorThemeName: string
  cursorStyles: CursorStyles
  activeSidePanelTab: SidePanelTab
}
export interface UIActions {
  setMode: (mode: AppearanceMode) => void
  initializeSettings: () => Promise<void>
  togglePreviewFullScreen: () => void
  setCursorThemeName: (themeName: string) => void
  updateCursorStyle: (style: Partial<CursorStyles>) => void
  setActiveSidePanelTab: (tab: SidePanelTab) => void
}

export interface AudioState {
  masterVolume: number // 0 to 1
  masterMuted: boolean
  micVolume: number // 0 to 1
  micMuted: boolean
  systemVolume: number // 0 to 1
  systemMuted: boolean
  // Legacy aliases mapped to master controls.
  volume: number // 0 to 1
  isMuted: boolean
}

export interface AudioActions {
  setMasterVolume: (volume: number) => void
  toggleMasterMute: () => void
  setMasterMuted: (isMuted: boolean) => void
  setMicVolume: (volume: number) => void
  toggleMicMute: () => void
  setMicMuted: (isMuted: boolean) => void
  setSystemVolume: (volume: number) => void
  toggleSystemMute: () => void
  setSystemMuted: (isMuted: boolean) => void
  // Legacy actions preserved as master wrappers.
  setVolume: (volume: number) => void
  toggleMute: () => void
  setIsMuted: (isMuted: boolean) => void
}

export type RenderableState = Pick<
  EditorState,
  | 'platform'
  | 'frameStyles'
  | 'videoDimensions'
  | 'aspectRatio'
  | 'webcamPosition'
  | 'webcamStyles'
  | 'isWebcamVisible'
  | 'zoomRegions'
  | 'cutRegions'
  | 'speedRegions'
  | 'blurRegions'
  | 'swapRegions'
  | 'timelineLanes'
  | 'metadata'
  | 'recordingGeometry'
  | 'cursorImages'
  | 'cursorBitmapsToRender'
  | 'syncOffset'
  | 'cursorTheme'
  | 'cursorStyles'
>

// Combined state type for the editor store
export type EditorState = ProjectState &
  PlaybackState &
  FrameState &
  TimelineState &
  PresetState &
  WebcamState &
  UIState &
  AudioState

// Combined actions type for the editor store
export type EditorActions = ProjectActions &
  PlaybackActions &
  FrameActions &
  TimelineActions &
  PresetActions &
  WebcamActions &
  UIActions &
  AudioActions & {
    // Global reset action
    reset: () => void
  }

// A utility type to create actions for a slice
export type Slice<T extends object, A extends object> = (
  set: (fn: (draft: EditorState) => void) => void,
  get: () => EditorState & EditorActions,
) => T & A

export * from './auth'
