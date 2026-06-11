// Handlers for recording-related IPC (recording).

import {
  startRecording,
  loadVideoFromFile,
  stopRecording,
  importProjectFromFile,
  selectRecordingArea,
  analyzeRecordingCapability,
} from '../../features/recording-manager'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function handleStartRecording(_event: any, options: any) {
  return startRecording(options)
}

export function handleAnalyzeRecordingCapability() {
  return analyzeRecordingCapability()
}

export function handleLoadVideoFromFile() {
  return loadVideoFromFile()
}

export function handleImportProject() {
  return importProjectFromFile()
}

export function handleSelectArea() {
  return selectRecordingArea()
}

export async function handleStopRecording() {
  await stopRecording()
}
