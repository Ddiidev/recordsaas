import { useEditorStore } from '../../store/editorStore'
import { RegionSettingsPanel } from './RegionSettingsPanel'
import {
  CameraSolid,
  DeviceComputerCamera,
  FileImport,
  IconShell,
  IconSwitch,
  LayoutBoard,
  Microphone,
  MicrophoneSolid,
  PathArrowSolid,
  Pointer,
  Route,
  UploadSquareSolid,
} from '@icons'
import { BackgroundSettings } from './sidepanel/BackgroundSettings'
import { FrameEffectsSettings } from './sidepanel/FrameEffectsSettings'
import { CameraSettings } from './sidepanel/CameraSettings'
import { CursorSettings } from './sidepanel/CursorSettings'
import { AnimationSettingsPanel } from './sidepanel/AnimationSettingsPanel'
import { useShallow } from 'zustand/react/shallow'
import { useEffect, useMemo } from 'react'
import { cn } from '../../lib/utils'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip'
import { AudioSettings } from './sidepanel/AudioSettings'
import { MediaAssetsPanel } from './sidepanel/MediaAssetsPanel'

interface TabButtonProps {
  label: string
  icon: React.ReactNode
  isActive: boolean
  onClick: () => void
  disabled?: boolean
}

function TabButton({ label, icon, isActive, onClick, disabled }: TabButtonProps) {
  return (
    <TooltipProvider delayDuration={500}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={onClick}
            className={cn(
              'icon-hover group flex w-full flex-col items-center justify-center rounded-lg px-1.5 py-2 transition-all duration-150',
              'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 ring-offset-sidebar',
              isActive
                ? 'bg-accent/70 text-primary shadow-sm'
                : 'text-muted-foreground hover:bg-accent/25 hover:text-foreground',
              disabled && 'cursor-not-allowed opacity-50 hover:bg-transparent hover:text-muted-foreground',
            )}
            aria-label={label}
            disabled={disabled}
          >
            <span className="flex h-9 w-9 items-center justify-center">
              {icon}
            </span>
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="left"
          sideOffset={8}
          className="capitalize px-3 py-1.5 text-sm font-medium bg-popover text-popover-foreground shadow-md rounded-md border border-border/50 dark:bg-popover/95 dark:border-border/80 dark:text-foreground"
        >
          <p className="whitespace-nowrap">{label}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

function FrameSettingsPanel() {
  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-6 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          <IconShell active className="h-10 w-10">
            <LayoutBoard className="h-5 w-5" />
          </IconShell>
          <div>
            <h2 className="text-lg font-semibold text-sidebar-foreground">General Settings</h2>
            <p className="text-sm text-muted-foreground">Customize your video&apos;s appearance</p>
          </div>
        </div>
      </div>
      {/* Content */}
      <div className="flex-1 overflow-y-auto stable-scrollbar">
        {' '}
        {/* MODIFIED HERE */}
        <div className="p-6 space-y-8">
          <BackgroundSettings />
          <FrameEffectsSettings />
        </div>
      </div>
    </div>
  )
}

export function SidePanel() {
  // Get necessary states from the store
  const {
    selectedRegionId,
    zoomRegions,
    cutRegions,
    blurRegions,
    speedRegions,
    swapRegions,
    mediaAudioRegions,
    changeSoundRegions,
    webcamVideoUrl,
    hasAudioTrack,
    setSelectedRegionId,
    activeSidePanelTab,
    setActiveSidePanelTab,
  } = useEditorStore(
    useShallow((state) => ({
      selectedRegionId: state.selectedRegionId,
      zoomRegions: state.zoomRegions,
      cutRegions: state.cutRegions,
      blurRegions: state.blurRegions,
      speedRegions: state.speedRegions,
      swapRegions: state.swapRegions,
      mediaAudioRegions: state.mediaAudioRegions,
      changeSoundRegions: state.changeSoundRegions,
      webcamVideoUrl: state.webcamVideoUrl,
      hasAudioTrack: state.hasAudioTrack,
      setSelectedRegionId: state.setSelectedRegionId,
      activeSidePanelTab: state.activeSidePanelTab,
      setActiveSidePanelTab: state.setActiveSidePanelTab,
    })),
  )

  // Optimize region lookup using useMemo
  const selectedRegion = useMemo(() => {
    if (!selectedRegionId) return null
    return (
      zoomRegions[selectedRegionId] ||
      cutRegions[selectedRegionId] ||
      blurRegions[selectedRegionId] ||
      speedRegions[selectedRegionId] ||
      swapRegions[selectedRegionId] ||
      mediaAudioRegions[selectedRegionId] ||
      changeSoundRegions[selectedRegionId]
    )
  }, [selectedRegionId, zoomRegions, cutRegions, blurRegions, speedRegions, swapRegions, mediaAudioRegions, changeSoundRegions])

  // Auto switch to 'general' tab when a region is selected
  useEffect(() => {
    if (selectedRegion) {
      setActiveSidePanelTab('general')
    }
  }, [selectedRegion, setActiveSidePanelTab])

  // Handle Escape key to clear selection
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && selectedRegionId) {
        setSelectedRegionId(null)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedRegionId, setSelectedRegionId])

  return (
    <div className="h-full flex">
      {/* Vertical Tab Navigator (Always visible) */}
      <div className="w-[64px] flex-shrink-0 border-r border-sidebar-border bg-sidebar/90 p-3">
        <div className="flex flex-col items-center space-y-2">
          <TabButton
            label="General"
            icon={<IconSwitch regular={LayoutBoard} active={activeSidePanelTab === 'general'} className="h-[18px] w-[18px]" />}
            isActive={activeSidePanelTab === 'general'}
            onClick={() => setActiveSidePanelTab('general')}
          />
          <TabButton
            label="Camera"
            icon={
              <IconSwitch
                regular={DeviceComputerCamera}
                solid={CameraSolid}
                active={activeSidePanelTab === 'camera'}
                className="h-[18px] w-[18px]"
              />
            }
            isActive={activeSidePanelTab === 'camera'}
            onClick={() => setActiveSidePanelTab('camera')}
            disabled={!webcamVideoUrl}
          />
          <TabButton
            label="Audio"
            icon={
              <IconSwitch
                regular={Microphone}
                solid={MicrophoneSolid}
                active={activeSidePanelTab === 'audio'}
                className="h-[18px] w-[18px]"
              />
            }
            isActive={activeSidePanelTab === 'audio'}
            onClick={() => setActiveSidePanelTab('audio')}
            disabled={!hasAudioTrack}
          />
          <TabButton
            label="Media"
            icon={
              <IconSwitch
                regular={FileImport}
                solid={UploadSquareSolid}
                active={activeSidePanelTab === 'media'}
                className="h-[18px] w-[18px]"
              />
            }
            isActive={activeSidePanelTab === 'media'}
            onClick={() => setActiveSidePanelTab('media')}
          />
          <TabButton
            label="Animation"
            icon={
              <IconSwitch
                regular={Route}
                solid={PathArrowSolid}
                active={activeSidePanelTab === 'animation'}
                className="h-[18px] w-[18px]"
              />
            }
            isActive={activeSidePanelTab === 'animation'}
            onClick={() => setActiveSidePanelTab('animation')}
          />
          <TabButton
            label="Cursor"
            icon={<IconSwitch regular={Pointer} active={activeSidePanelTab === 'cursor'} className="h-[18px] w-[18px]" />}
            isActive={activeSidePanelTab === 'cursor'}
            onClick={() => setActiveSidePanelTab('cursor')}
          />
        </div>
      </div>

      {/* Main content area */}
      <div className="flex-1 bg-sidebar overflow-hidden relative">
        {/* Render all panels but only show the active one.
            This prevents unmounting and preserves the internal state of components like Collapse. */}
        <div className="h-full" hidden={activeSidePanelTab !== 'general'}>
          {selectedRegion ? <RegionSettingsPanel region={selectedRegion} /> : <FrameSettingsPanel />}
        </div>
        <div className="h-full" hidden={activeSidePanelTab !== 'camera'}>
          <CameraSettings />
        </div>
        <div className="h-full" hidden={activeSidePanelTab !== 'audio'}>
          <AudioSettings />
        </div>
        <div className="h-full" hidden={activeSidePanelTab !== 'media'}>
          <MediaAssetsPanel />
        </div>
        <div className="h-full" hidden={activeSidePanelTab !== 'animation'}>
          <AnimationSettingsPanel />
        </div>
        <div className="h-full" hidden={activeSidePanelTab !== 'cursor'}>
          <CursorSettings />
        </div>
      </div>
    </div>
  )
}
