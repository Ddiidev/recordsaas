import { useEffect, useRef, useState, useCallback } from 'react'
import { useEditorStore } from '../store/editorStore'
import { Preview } from '../components/editor/Preview'
import { SidePanel } from '../components/editor/SidePanel'
import { Timeline } from '../components/editor/Timeline'
import { PreviewControls } from '../components/editor/PreviewControls'
import { UpdateNotification } from '../components/editor/UpdateNotification'
import { ExportButton } from '../components/editor/ExportButton'
import { ExportProjectButton } from '../components/editor/ExportProjectButton'
import { ExportModal } from '../components/editor/ExportModal'
import { WindowControls } from '../components/editor/WindowControls'
import { PresetModal } from '../components/editor/PresetModal'
import { SettingsModal } from '../components/settings/SettingsModal'
import { Stack3, Loader2, Check, Settings, Home } from '@icons'
import { cn } from '../lib/utils'
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts'
import { useExportProcess } from '../hooks/useExportProcess'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { TooltipProvider, SimpleTooltip } from '../components/ui/tooltip'
import { useShallow } from 'zustand/react/shallow'
import { getMediaPathBasename, normalizeMediaPath } from '../lib/media-url'

const generateDefaultProjectName = () => {
  const now = new Date()
  const timestamp = now.toISOString().replace(/[:.]/g, '-').replace('T', '-').slice(0, 16)
  return `RecordSaaS-${timestamp}`
}

export function EditorPage() {
  const {
    loadProject,
    deleteRegion,
    initializePresets,
    initializeSettings,
    togglePlay,
    togglePreviewFullScreen,
    seekToNextFrame,
    seekToPreviousFrame,
    seekBackward,
    seekForward,
  } = useEditorStore.getState()
  const { presetSaveStatus, duration, isPreviewFullScreen } = useEditorStore(
    useShallow((state) => ({
      presetSaveStatus: state.presetSaveStatus,
      duration: state.duration,
      isPreviewFullScreen: state.isPreviewFullScreen,
    })),
  )
  const { undo, redo } = useEditorStore.temporal.getState()
  const {
    isModalOpen: isExportModalOpen,
    isExporting,
    progress: exportProgress,
    result: exportResult,
    openExportModal,
    closeExportModal,
    startExport,
    cancelExport,
  } = useExportProcess()

  // Timeline lanes setup and management
  useEditorStore(
    useShallow((state) => ({
      lanes: state.timelineLanes,
      addLane: state.addTimelineLane,
      removeLane: state.removeTimelineLane,
      moveLane: state.moveTimelineLane,
    })),
  )

  const videoRef = useRef<HTMLVideoElement>(null)
  const readyForProjectSentRef = useRef(false)
  const lastProjectPayloadKeyRef = useRef<string | null>(null)
  const [isPresetModalOpen, setPresetModalOpen] = useState(false)
  const [isSettingsModalOpen, setSettingsModalOpen] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<{ version: string; url: string } | null>(null)
  const [platform, setPlatform] = useState<NodeJS.Platform | null>(null)
  const [isExportingProject, setIsExportingProject] = useState(false)
  const [isProjectNamePopupOpen, setProjectNamePopupOpen] = useState(false)
  const [projectExportName, setProjectExportName] = useState(generateDefaultProjectName)
  const [projectNameError, setProjectNameError] = useState<string | null>(null)
  const [isProjectNameValid, setProjectNameValid] = useState(true)
  const isImportedProject = !!useEditorStore((state) => state.originalProjectPath)

  useEffect(() => {
    if (!isProjectNamePopupOpen) return

    let cancelled = false
    const validateProjectName = async () => {
      const result = await window.electronAPI.validateProjectFolderName(projectExportName)
      if (cancelled) return
      setProjectNameValid(result.valid)
      setProjectNameError(result.valid ? null : result.error || 'Invalid project name.')
    }

    void validateProjectName()

    return () => {
      cancelled = true
    }
  }, [isProjectNamePopupOpen, projectExportName])

  const handleExportProject = useCallback(async (projectName?: string) => {
    try {
      setIsExportingProject(true)
      const storeState = useEditorStore.getState()
      const { videoPath, metadataPath, audioPath, webcamVideoPath, mediaAudioClip, originalProjectPath } = storeState
      
      const mediaFiles = [videoPath, metadataPath, audioPath, webcamVideoPath, mediaAudioClip?.path]
        .map((filePath) => normalizeMediaPath(filePath))
        .filter((filePath): filePath is string => Boolean(filePath))
      
      let targetFolder = originalProjectPath
      const filesToExport = mediaFiles
      
      if (!targetFolder) {
        const resolvedProjectFolder = await window.electronAPI.resolveProjectFolder(projectName || projectExportName)
        if (!resolvedProjectFolder.success || !resolvedProjectFolder.targetFolder) {
          setProjectNameError(resolvedProjectFolder.error || 'Invalid project name.')
          setProjectNameValid(false)
          return
        }

        targetFolder = resolvedProjectFolder.targetFolder
        setProjectExportName(resolvedProjectFolder.normalizedName || projectName || projectExportName)
      }
      
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stateToSave = { ...storeState } as any
      delete stateToSave.cursorBitmapsToRender
      stateToSave.events = storeState.metadata
      delete stateToSave.metadata
      
      if (stateToSave.videoPath) stateToSave.videoPath = getMediaPathBasename(stateToSave.videoPath)
      if (stateToSave.metadataPath) stateToSave.metadataPath = getMediaPathBasename(stateToSave.metadataPath)
      if (stateToSave.audioPath) stateToSave.audioPath = getMediaPathBasename(stateToSave.audioPath)
      if (stateToSave.webcamVideoPath) stateToSave.webcamVideoPath = getMediaPathBasename(stateToSave.webcamVideoPath)
      if (stateToSave.mediaAudioClip?.path) {
        const serializedMediaPath = getMediaPathBasename(stateToSave.mediaAudioClip.path)
        stateToSave.mediaAudioClip = {
          ...stateToSave.mediaAudioClip,
          path: serializedMediaPath,
          url: `media://${serializedMediaPath}`,
        }
      }
      
      const projectData = JSON.stringify(stateToSave, null, 2)
      
      const saveResult = await window.electronAPI.saveProject(targetFolder, projectData, filesToExport)
      
      if (saveResult.success) {
        if (!originalProjectPath) {
          useEditorStore.getState().setOriginalProjectPath(targetFolder)
          window.electronAPI.showItemInFolder(targetFolder)
        }
        setProjectNamePopupOpen(false)
      } else {
        alert(`Failed to export project: ${saveResult.error}`)
      }
    } catch (error: unknown) {
      console.error(error)
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      alert(`Error: ${errorMessage}`)
    } finally {
      setIsExportingProject(false)
    }
  }, [projectExportName])

  const handleExportProjectButtonClick = useCallback(() => {
    const originalProjectPath = useEditorStore.getState().originalProjectPath
    if (originalProjectPath) {
      void handleExportProject()
      return
    }

    setProjectExportName(generateDefaultProjectName())
    setProjectNameError(null)
    setProjectNameValid(true)
    setProjectNamePopupOpen(true)
  }, [handleExportProject])

  const handleConfirmProjectExport = useCallback(async () => {
    const validation = await window.electronAPI.validateProjectFolderName(projectExportName)
    if (!validation.valid) {
      setProjectNameValid(false)
      setProjectNameError(validation.error || 'Invalid project name.')
      return
    }

    await handleExportProject(validation.normalizedName || projectExportName)
  }, [handleExportProject, projectExportName])

  const handleDeleteSelectedRegion = useCallback(() => {
    const currentSelectedId = useEditorStore.getState().selectedRegionId
    if (currentSelectedId) {
      deleteRegion(currentSelectedId)
    }
  }, [deleteRegion])

  const handleSeekFrame = useCallback(
    (direction: 'next' | 'prev') => {
      if (direction === 'next') {
        seekToNextFrame()
      } else {
        seekToPreviousFrame()
      }
      if (videoRef.current) {
        videoRef.current.currentTime = useEditorStore.getState().currentTime
      }
    },
    [seekToNextFrame, seekToPreviousFrame],
  )

  const handleSeekByTime = useCallback(
    (seconds: number) => {
      if (seconds > 0) {
        seekForward(seconds)
      } else {
        seekBackward(Math.abs(seconds))
      }
      if (videoRef.current) {
        videoRef.current.currentTime = useEditorStore.getState().currentTime
      }
    },
    [seekForward, seekBackward],
  )

  useKeyboardShortcuts(
    {
      delete: handleDeleteSelectedRegion,
      backspace: handleDeleteSelectedRegion,
      ' ': (e) => {
        e.preventDefault()
        togglePlay()
      },
      j: () => handleSeekFrame('prev'),
      k: () => handleSeekFrame('next'),
      arrowleft: () => handleSeekByTime(-1),
      arrowright: () => handleSeekByTime(1),
      f: () => togglePreviewFullScreen(),
      'ctrl+z': (e) => {
        e.preventDefault()
        undo()
      },
      'ctrl+y': (e) => {
        e.preventDefault()
        redo()
      },
      'ctrl+shift+z': (e) => {
        e.preventDefault()
        redo()
      },
    },
    [handleDeleteSelectedRegion, undo, redo, togglePlay, handleSeekFrame, togglePreviewFullScreen],
  )

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isPreviewFullScreen) {
        togglePreviewFullScreen()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isPreviewFullScreen, togglePreviewFullScreen])

  useEffect(() => {
    const cleanup = window.electronAPI.onUpdateAvailable((info: { version: string; url: string }) => {
      setUpdateInfo(info)
    })
    return () => cleanup()
  }, [])

  useEffect(() => {
    window.electronAPI.getPlatform().then(setPlatform)
    initializeSettings()
    const cleanup = window.electronAPI.onProjectOpen(async (payload) => {
      const payloadKey = [payload.videoPath, payload.metadataPath, payload.webcamVideoPath, payload.audioPath, payload.originalProjectPath].join('\0')
      if (lastProjectPayloadKeyRef.current === payloadKey) {
        console.info(`[EditorPage] Ignoring duplicate project payload: ${payload.videoPath}`)
        return
      }
      lastProjectPayloadKeyRef.current = payloadKey
      console.info(`[EditorPage] Received project payload: ${payload.videoPath}`)
      await initializePresets()
      await loadProject(payload)
      useEditorStore.temporal.getState().clear()
    })
    if (!readyForProjectSentRef.current) {
      readyForProjectSentRef.current = true
      window.electronAPI.editorReadyForProject()
    }
    return () => cleanup()
  }, [loadProject, initializePresets, initializeSettings])

  const getPresetButtonContent = () => {
    switch (presetSaveStatus) {
      case 'saving':
        return (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...
          </>
        )
      case 'saved':
        return (
          <>
            <Check className="w-4 h-4 mr-2" /> Saved!
          </>
        )
      default:
        return (
          <>
            <Stack3 className="w-4 h-4 mr-2" /> Presets
          </>
        )
    }
  }

  const renderHeaderActions = () => {
    const actions = [
      <div key="export-project" className="relative z-[1100]">
        <ExportProjectButton
          isImportedProject={isImportedProject}
          isExporting={isExportingProject}
          onClick={handleExportProjectButtonClick}
          disabled={duration <= 0}
        />
        {isProjectNamePopupOpen && !isImportedProject && (
          <div className="absolute left-0 top-11 z-[1200] w-80 rounded-lg border border-border bg-background p-3 shadow-xl">
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground" htmlFor="project-export-name">
                  Project name
                </label>
                <Input
                  id="project-export-name"
                  value={projectExportName}
                  onChange={(event) => setProjectExportName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && isProjectNameValid && !isExportingProject) {
                      void handleConfirmProjectExport()
                    }
                    if (event.key === 'Escape') {
                      setProjectNamePopupOpen(false)
                    }
                  }}
                  autoFocus
                  className="mt-1 h-9"
                />
                {projectNameError && <p className="mt-1 text-xs text-red-500">{projectNameError}</p>}
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setProjectNamePopupOpen(false)}
                  disabled={isExportingProject}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={() => void handleConfirmProjectExport()}
                  disabled={!isProjectNameValid || isExportingProject}
                >
                  Save Project
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>,
      <ExportButton key="export" isExporting={isExporting} onClick={openExportModal} disabled={duration <= 0} />,
      <Button
        key="presets"
        variant="secondary"
        size="sm"
        onClick={() => setPresetModalOpen(true)}
        disabled={presetSaveStatus === 'saving'}
        className={cn(
          'transition-all duration-300 w-[110px] h-8 font-medium shadow-sm border border-dashed hover:border-green-500',
          presetSaveStatus === 'saved' ? 'bg-green-500/15 border-green-500/30' : 'border-green-500/50',
          'text-green-600 dark:text-green-400 shadow-green-500/10',
        )}
      >
        {getPresetButtonContent()}
      </Button>,
      <SimpleTooltip key="settings" content="Settings">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setSettingsModalOpen(true)}
          aria-label="Open Settings"
          className={cn('h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-accent/50 rounded-lg border border-border shadow-sm')}
        >
          <Settings className="w-4 h-4" />
        </Button>
      </SimpleTooltip>,
      <div key="separator" className="w-px h-6 bg-border mx-1" />,
      <SimpleTooltip key="home" content="Home">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => window.electronAPI.openRecorder()}
          aria-label="Home"
          className={cn('h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-accent/50 rounded-lg border border-border shadow-sm')}
        >
          <Home className="w-4 h-4" />
        </Button>
      </SimpleTooltip>,
      updateInfo && <UpdateNotification key="update" info={updateInfo} />,
    ].filter(Boolean)

    return actions
  }

  const showCustomWindowControls = platform === 'linux' || platform === 'darwin'

  return (
    <TooltipProvider delayDuration={400}>
      <main className="h-screen w-screen bg-background flex flex-col overflow-hidden select-none">
        {/*
          Instead of conditionally rendering the entire layout, we now render it once
          and use CSS classes to hide/show elements and expand the preview for fullscreen.
          This prevents components like SidePanel from unmounting, preserving their internal state.
        */}
        <header
          className={cn(
            'relative z-[1000] h-12 flex-shrink-0 border-b border-border/50 bg-card/80 backdrop-blur-xl flex items-center justify-between px-3 shadow-xs',
            isPreviewFullScreen && 'hidden', // Hide header in fullscreen
          )}
          style={{ WebkitAppRegion: 'drag' }}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2" style={{ WebkitAppRegion: 'no-drag' }}>
            {renderHeaderActions()}
          </div>

          {/* Centered Title */}
          <h1 className="text-sm font-bold text-foreground pointer-events-none tracking-tight absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            Record<span className="text-primary">SaaS</span>
          </h1>

          <div className="flex flex-1 items-center justify-end">
            {showCustomWindowControls ? <WindowControls /> : platform === 'win32' ? <div className="w-[112px]" aria-hidden="true" /> : null}
          </div>
        </header>

        <div className={cn('flex flex-row-reverse flex-1 overflow-hidden', isPreviewFullScreen && 'h-full w-full')}>
          <div
            className={cn(
              'w-[28rem] flex-shrink-0 bg-sidebar border-l border-sidebar-border overflow-hidden',
              isPreviewFullScreen && 'hidden', // Hide SidePanel in fullscreen
            )}
          >
            <SidePanel />
          </div>
          <div className="flex-1 flex flex-col overflow-hidden bg-background">
            <div
              className={cn(
                'flex-1 flex items-center justify-center p-6 overflow-hidden min-h-0',
                // Make the preview container expand to fill the screen in fullscreen mode
                isPreviewFullScreen && 'fixed inset-0 z-50 bg-black p-0',
              )}
            >
              <Preview videoRef={videoRef} onSeekFrame={handleSeekFrame} />
            </div>
            <div className={cn('flex-shrink-0', isPreviewFullScreen && 'hidden')}>
              <PreviewControls />
            </div>
            <div
              className={cn(
                'flex-shrink-0 bg-card/60 border-t border-border/50 backdrop-blur-sm overflow-hidden',
                isPreviewFullScreen && 'hidden', // Hide Timeline in fullscreen
              )}
            >
              <Timeline videoRef={videoRef} />
            </div>
          </div>
        </div>

        <SettingsModal isOpen={isSettingsModalOpen} onClose={() => setSettingsModalOpen(false)} />
        <PresetModal isOpen={isPresetModalOpen} onClose={() => setPresetModalOpen(false)} />
        <ExportModal
          isOpen={isExportModalOpen}
          onClose={closeExportModal}
          onStartExport={startExport}
          onCancelExport={cancelExport}
          isExporting={isExporting}
          progress={exportProgress}
          result={exportResult}
        />
      </main>
    </TooltipProvider>
  )
}
