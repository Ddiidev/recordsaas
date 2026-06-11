// Handlers for export-related IPC (export video).

import { IpcMainInvokeEvent } from 'electron'
import { probeSourceVideoInfo, startExport } from '../../features/export-manager'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function handleStartExport(event: IpcMainInvokeEvent, payload: any) {
  return startExport(event, payload)
}

export function handleProbeSourceVideoInfo(_event: IpcMainInvokeEvent, videoPath: string | null | undefined) {
  return probeSourceVideoInfo(videoPath)
}
