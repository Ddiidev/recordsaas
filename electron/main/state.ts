/* eslint-disable @typescript-eslint/no-explicit-any */
// Manages global application state in a centralized way.

import { BrowserWindow, Tray } from 'electron'
import { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { IMouseTracker } from './features/mouse-tracker'
import type {
  ScreenEncoderPreference,
  ScreenEncoderSelectionMode,
  ScreenEncoderVendor,
} from '../../src/types/screen-encoder'

// ADDED: Define RecordingGeometry type here for better reusability
export interface RecordingGeometry {
  x: number
  y: number
  width: number
  height: number
}

export interface RecordingSession {
  screenVideoPath: string
  metadataPath: string
  webcamVideoPath?: string
  audioPath?: string
  systemAudioPath?: string
  systemAudioTempPath?: string
  mediaAudioPath?: string
  recordingGeometry: RecordingGeometry
  scaleFactor: number // Display scale factor (for Windows DPI scaling)
  screenCaptureBackend?: string
  requestedScreenFps?: number
  recordingAudioCodec?: 'aac' | 'mp3'
  recordingAudioBitrateKbps?: 128 | 192 | 320
  recordingAudioSampleRate?: 44100 | 48000
  originalProjectPath?: string
}

interface AppState {
  // Windows
  recorderWin: BrowserWindow | null
  editorWin: BrowserWindow | null
  renderWorker: BrowserWindow | null
  savingWin: BrowserWindow | null
  selectionWin: BrowserWindow | null
  exportProgressWin: BrowserWindow | null
  currentExportProgress: { progress: number; stage: string; exportSessionId?: string } | null

  // System
  tray: Tray | null
  exportTray: Tray | null

  // Processes & Streams
  ffmpegProcess: ChildProcessWithoutNullStreams | null
  ffmpegProcesses: ChildProcessWithoutNullStreams[]
  systemAudioHelperProcess: ChildProcessWithoutNullStreams | null
  mouseTracker: IMouseTracker | null

  // In-memory recording data
  recordedMouseEvents: any[]
  runtimeCursorImageMap: Map<string, any>

  // Recording State
  recordingStartTime: number
  originalCursorScale: number | null
  currentRecordingSession: RecordingSession | null
  currentEditorSessionFiles: RecordingSession | null

  // Flags
  isCleanupInProgress: boolean
}

export const appState: AppState = {
  recorderWin: null,
  editorWin: null,
  renderWorker: null,
  savingWin: null,
  selectionWin: null,
  exportProgressWin: null,
  currentExportProgress: null,
  tray: null,
  exportTray: null,
  ffmpegProcess: null,
  ffmpegProcesses: [],
  systemAudioHelperProcess: null,
  mouseTracker: null,
  recordedMouseEvents: [],
  runtimeCursorImageMap: new Map(),
  recordingStartTime: 0,
  originalCursorScale: null,
  currentRecordingSession: null,
  currentEditorSessionFiles: null,
  isCleanupInProgress: false,
}
