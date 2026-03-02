import { useState, useEffect, useCallback } from 'react'
import { useEditorStore } from '../store/editorStore'
import { ExportSettings } from '../components/editor/ExportModal'

/**
 * Custom hook to manage the entire video export process.
 * It encapsulates state management, IPC listeners, and handler functions
 * related to exporting, cleaning up the EditorPage component.
 */
export const useExportProcess = () => {
  const [isModalOpen, setModalOpen] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<{ success: boolean; outputPath?: string; error?: string; duration?: number } | null>(null)

  const withRefundSupportHint = (message: string) =>
    `${message} If credits were charged and this export failed, request refund review at contato@recordsaas.com.`

  const extractErrorMessage = (error: unknown): string => {
    if (error instanceof Error) return error.message
    if (typeof error === 'string') return error
    return 'Unknown export error'
  }

  const parseInsufficientCreditsError = (message: string): {
    buyUrl: string
    requiredCredits: string
    availableCredits: string
  } | null => {
    const marker = 'INSUFFICIENT_CREDITS|'
    const markerIndex = message.indexOf(marker)
    if (markerIndex < 0) return null

    const serializedPayload = message.slice(markerIndex).split('\n')[0]
    const parts = serializedPayload.split('|')
    const buyUrl = parts[1] || 'https://recordsaas.app/account/'
    const required = Number(parts[2])
    const available = Number(parts[3])

    return {
      buyUrl,
      requiredCredits: Number.isFinite(required) && required >= 0 ? required.toFixed(required % 1 === 0 ? 0 : 1) : 'unknown',
      availableCredits: Number.isFinite(available) && available >= 0 ? available.toFixed(available % 1 === 0 ? 0 : 1) : 'unknown',
    }
  }

  // Effect to set up and tear down IPC listeners for export progress and completion
  useEffect(() => {
    const cleanProgressListener = window.electronAPI.onExportProgress(({ progress }) => {
      setProgress((currentProgress) => {
        const safeProgress = Number.isFinite(progress) ? progress : currentProgress
        if (Math.floor(safeProgress) === Math.floor(currentProgress)) {
          return currentProgress
        }
        return safeProgress
      })
    })

    const cleanCompleteListener = window.electronAPI.onExportComplete(({ success, outputPath, error, duration }) => {
      setIsExporting(false)
      setProgress(100)
      const hasMeaningfulError = !success && typeof error === 'string' && error.length > 0 && error !== 'Export cancelled.'
      const normalizedError = hasMeaningfulError ? withRefundSupportHint(error) : error
      setResult({ success, outputPath, error: normalizedError, duration })
    })

    return () => {
      cleanProgressListener()
      cleanCompleteListener()
    }
  }, [])

  // Handler to initiate the export process
  const handleStartExport = useCallback(async (settings: ExportSettings, outputPath: string) => {
    const fullState = useEditorStore.getState()
    const plainState = {
      platform: fullState.platform,
      videoPath: fullState.videoPath,
      metadata: fullState.metadata,
      videoDimensions: fullState.videoDimensions,
      duration: fullState.duration,
      frameStyles: fullState.frameStyles,
      aspectRatio: fullState.aspectRatio,
      zoomRegions: fullState.zoomRegions,
      cutRegions: fullState.cutRegions,
      speedRegions: fullState.speedRegions,
      blurRegions: fullState.blurRegions,
      timelineLanes: fullState.timelineLanes,
      webcamVideoPath: fullState.webcamVideoPath,
      webcamPosition: fullState.webcamPosition,
      webcamStyles: fullState.webcamStyles,
      isWebcamVisible: fullState.isWebcamVisible,
      recordingGeometry: fullState.recordingGeometry,
      cursorImages: fullState.cursorImages,
      cursorTheme: fullState.cursorTheme,
      cursorStyles: fullState.cursorStyles,
      syncOffset: fullState.syncOffset,
      audioPath: fullState.audioPath,
      audioUrl: fullState.audioUrl,
    }

    setResult(null)
    setIsExporting(true)
    setProgress(0)

    try {
      await window.electronAPI.startExport({
        projectState: plainState,
        exportSettings: settings,
        outputPath: outputPath,
      })
    } catch (e) {
      console.error('Export invocation failed', e)
      const message = extractErrorMessage(e)
      const insufficient = parseInsufficientCreditsError(message)

      if (insufficient) {
        const shouldOpenAccount = window.confirm(
          `Insufficient credits. Required: ${insufficient.requiredCredits}, available: ${insufficient.availableCredits}. Open account page now?`,
        )

        if (shouldOpenAccount) {
          window.electronAPI.openExternal(insufficient.buyUrl)
        }

        setResult({
          success: false,
          error: `Insufficient credits. Required: ${insufficient.requiredCredits}, available: ${insufficient.availableCredits}.`,
        })
        setIsExporting(false)
        return
      }

      if (message.includes('AUTH_REQUIRED') || message.includes('Authorization header') || message.includes('Token expired')) {
        setResult({
          success: false,
          error: 'Your session expired or is invalid. Please log in again and retry export.',
        })
        setIsExporting(false)
        return
      }

      setResult({ success: false, error: withRefundSupportHint(`An error occurred while starting the export: ${message}`) })
      setIsExporting(false)
    }
  }, [])

  // Handler to cancel an ongoing export
  const handleCancelExport = () => {
    window.electronAPI.cancelExport()
  }

  // Handler to close the modal and reset its state
  const handleCloseModal = () => {
    if (result) {
      setResult(null)
    }
    setModalOpen(false)
  }

  return {
    isModalOpen,
    isExporting,
    progress,
    result,
    openExportModal: () => setModalOpen(true),
    closeExportModal: handleCloseModal,
    startExport: handleStartExport,
    cancelExport: handleCancelExport,
  }
}
