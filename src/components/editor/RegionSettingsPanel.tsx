// Settings panel for editing timeline regions (zoom, cut, and blur)
import { useState, useEffect, useMemo } from 'react'
import { useEditorStore } from '../../store/editorStore'
import type {
  TimelineRegion,
  ZoomRegion,
  BlurRegion,
  BlurRegionStyle,
  SpeedRegion,
  CameraSwapRegion,
  MediaAudioRegion,
  ChangeSoundRegion,
  FloatingMonitorRegion,
  SwapParticipant,
} from '../../types'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import {
  Camera,
  Scissors,
  Pointer,
  Video,
  Trash,
  Search,
  PlayerTrackNext,
  Refresh,
  Music,
  AdjustmentsHorizontal,
  Marquee2,
  Square,
  SquareToggle,
  Wand,
} from '@icons'
import { FocusPointPicker } from './sidepanel/FocusPointPicker'
import { AnimationSettings } from './sidepanel/AnimationSettings'
import { Slider } from '../ui/slider'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { BLUR_REGION, DEFAULTS } from '../../lib/constants'
import { normalizeWebcamCrop } from '../../lib/webcam'
import { hexToRgb, rgbaToHexAlpha } from '../../lib/utils'
import { Switch } from '../ui/switch'
import { ColorPicker } from '../ui/color-picker'
import { Collapse } from '../ui/collapse'
import { WebcamCropEditor } from './preview/WebcamCropEditor'

interface RegionSettingsPanelProps {
  region: TimelineRegion
}

function ZoomSettings({ region }: { region: ZoomRegion }) {
  const { updateRegion, deleteRegion } = useEditorStore.getState()

  const [activeTab, setActiveTab] = useState(region.mode)

  const handleModeChange = (newMode: 'auto' | 'fixed') => {
    setActiveTab(newMode)
    updateRegion(region.id, { mode: newMode })
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-sidebar-foreground mb-3 tracking-tight">Zoom Type</h3>
        <div className="grid grid-cols-2 gap-2 p-1 bg-muted/50 rounded-lg">
          <Button
            variant={activeTab === 'auto' ? 'secondary' : 'ghost'}
            onClick={() => handleModeChange('auto')}
            className="h-auto py-2.5 flex items-center justify-center gap-2 transition-all duration-200"
          >
            <Pointer className="w-4 h-4" />
            <span className="font-medium">Auto</span>
          </Button>
          <Button
            variant={activeTab === 'fixed' ? 'secondary' : 'ghost'}
            onClick={() => handleModeChange('fixed')}
            className="h-auto py-2.5 flex items-center justify-center gap-2 transition-all duration-200"
          >
            <Video className="w-4 h-4" />
            <span className="font-medium">Fixed</span>
          </Button>
        </div>
      </div>

      {activeTab === 'auto' && (
        <div className="p-4 bg-primary/5 border border-primary/20 rounded-lg">
          <div className="flex items-start gap-3">
            <Pointer className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-foreground mb-1">Auto Tracking</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Zoom will automatically follow the mouse cursor in this area.
              </p>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'fixed' && (
        <FocusPointPicker
          regionId={region.id}
          targetX={region.targetX}
          targetY={region.targetY}
          startTime={region.startTime}
          onTargetChange={({ x, y }) => updateRegion(region.id, { targetX: x, targetY: y })}
        />
      )}

      <AnimationSettings region={region} />

      <div className="pt-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => deleteRegion(region.id)}
          className="w-full h-10 bg-destructive/10 hover:bg-destructive text-destructive hover:text-destructive-foreground transition-all duration-200 flex items-center gap-2 justify-center font-medium"
        >
          <Trash className="w-4 h-4" />
          <span>Delete Region</span>
        </Button>
      </div>
    </div>
  )
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value))

function BlurSettings({ region }: { region: BlurRegion }) {
  const { updateRegion, deleteRegion } = useEditorStore.getState()

  const updateBlurRect = (updates: Partial<Pick<BlurRegion, 'x' | 'y' | 'width' | 'height'>>) => {
    const width = clamp(updates.width ?? region.width, BLUR_REGION.WIDTH.min, BLUR_REGION.WIDTH.max)
    const height = clamp(updates.height ?? region.height, BLUR_REGION.HEIGHT.min, BLUR_REGION.HEIGHT.max)
    const x = clamp(updates.x ?? region.x, BLUR_REGION.X.min, BLUR_REGION.X.max - width)
    const y = clamp(updates.y ?? region.y, BLUR_REGION.Y.min, BLUR_REGION.Y.max - height)

    updateRegion(region.id, { x, y, width, height })
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2.5">
        <span className="text-sm font-medium text-sidebar-foreground">Style</span>
        <Select
          value={region.style}
          onValueChange={(value) => updateRegion(region.id, { style: value as BlurRegionStyle })}
        >
          <SelectTrigger className="h-10 text-sm border-border bg-card shadow-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="blur">Blur</SelectItem>
            <SelectItem value="pixelated">Pixelated</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Intensity</span>
          <span className="text-xs font-semibold text-primary tabular-nums">{region.intensity}</span>
        </div>
        <Slider
          min={BLUR_REGION.INTENSITY.min}
          max={BLUR_REGION.INTENSITY.max}
          step={BLUR_REGION.INTENSITY.step}
          value={region.intensity}
          onChange={(value) => updateRegion(region.id, { intensity: value })}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Position X</span>
            <span className="text-xs font-semibold text-primary tabular-nums">{Math.round(region.x * 100)}%</span>
          </div>
          <Slider
            min={BLUR_REGION.X.min}
            max={BLUR_REGION.X.max}
            step={BLUR_REGION.X.step}
            value={region.x}
            onChange={(value) => updateBlurRect({ x: value })}
          />
        </div>
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Position Y</span>
            <span className="text-xs font-semibold text-primary tabular-nums">{Math.round(region.y * 100)}%</span>
          </div>
          <Slider
            min={BLUR_REGION.Y.min}
            max={BLUR_REGION.Y.max}
            step={BLUR_REGION.Y.step}
            value={region.y}
            onChange={(value) => updateBlurRect({ y: value })}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Width</span>
            <span className="text-xs font-semibold text-primary tabular-nums">{Math.round(region.width * 100)}%</span>
          </div>
          <Slider
            min={BLUR_REGION.WIDTH.min}
            max={BLUR_REGION.WIDTH.max}
            step={BLUR_REGION.WIDTH.step}
            value={region.width}
            onChange={(value) => updateBlurRect({ width: value })}
          />
        </div>
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Height</span>
            <span className="text-xs font-semibold text-primary tabular-nums">{Math.round(region.height * 100)}%</span>
          </div>
          <Slider
            min={BLUR_REGION.HEIGHT.min}
            max={BLUR_REGION.HEIGHT.max}
            step={BLUR_REGION.HEIGHT.step}
            value={region.height}
            onChange={(value) => updateBlurRect({ height: value })}
          />
        </div>
      </div>

      <div className="pt-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => deleteRegion(region.id)}
          className="w-full h-10 bg-destructive/10 hover:bg-destructive text-destructive hover:text-destructive-foreground transition-all duration-200 flex items-center gap-2 justify-center font-medium"
        >
          <Trash className="w-4 h-4" />
          <span>Delete Region</span>
        </Button>
      </div>
    </div>
  )
}

const SPEED_OPTIONS = [1, 1.2, 1.4, 1.5, 1.6, 2, 3, 4, 8, 16]

function SpeedSettings({ region }: { region: SpeedRegion }) {
  const { updateRegion, deleteRegion, applySpeedToAll } = useEditorStore.getState()

  return (
    <div className="space-y-6">
      <div className="space-y-2.5">
        <span className="text-sm font-medium text-sidebar-foreground">Playback Speed</span>
        <Select
          value={String(region.speed)}
          onValueChange={(value) => updateRegion(region.id, { speed: Number(value) })}
        >
          <SelectTrigger className="h-10 text-sm border-border bg-card shadow-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SPEED_OPTIONS.map((speed) => (
              <SelectItem key={speed} value={String(speed)}>
                {speed}x
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="pt-2 space-y-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() => applySpeedToAll(region.speed)}
          className="w-full h-10 border-border hover:bg-accent hover:text-accent-foreground transition-all duration-200 flex items-center gap-2 justify-center font-medium"
        >
          <span>Apply {region.speed}x to all</span>
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={() => deleteRegion(region.id)}
          className="w-full h-10 bg-destructive/10 hover:bg-destructive text-destructive hover:text-destructive-foreground transition-all duration-200 flex items-center gap-2 justify-center font-medium"
        >
          <Trash className="w-4 h-4" />
          <span>Delete Region</span>
        </Button>
      </div>
    </div>
  )
}

function SwapSettings({ region }: { region: CameraSwapRegion }) {
  const { updateRegion, deleteRegion } = useEditorStore.getState()
  const { floatingMonitors, floatingMonitorRegions, timelineLanes, webcamVideoUrl } = useEditorStore((state) => ({
    floatingMonitors: state.floatingMonitors,
    floatingMonitorRegions: state.floatingMonitorRegions,
    timelineLanes: state.timelineLanes,
    webcamVideoUrl: state.webcamVideoUrl,
  }))
  const [durationText, setDurationText] = useState((region.transitionDuration ?? 0.3).toFixed(1))
  const regionEnd = region.startTime + region.duration
  const participantOptions = useMemo(() => {
    const monitors = Object.values(floatingMonitorRegions)
      .filter(
        (monitorRegion) =>
          monitorRegion.startTime < regionEnd && monitorRegion.startTime + monitorRegion.duration > region.startTime,
      )
      .map((monitorRegion) => {
        const monitor = floatingMonitors[monitorRegion.monitorId]
        const lane = timelineLanes.find((candidate) => candidate.id === monitorRegion.laneId)
        return {
          value: `monitor:${monitorRegion.id}`,
          label: `${monitor?.name || 'Asset'} · ${lane?.name || 'Lane'} · ${monitorRegion.startTime.toFixed(1)}–${(
            monitorRegion.startTime + monitorRegion.duration
          ).toFixed(1)}s`,
        }
      })
    return [
      { value: 'main-screen', label: 'Tela principal' },
      ...(webcamVideoUrl ? [{ value: 'webcam', label: 'Webcam' }] : []),
      ...monitors,
    ]
  }, [floatingMonitorRegions, floatingMonitors, region.startTime, regionEnd, timelineLanes, webcamVideoUrl])

  const participantValue = (participant: SwapParticipant) =>
    participant.kind === 'floating-monitor-region' ? `monitor:${participant.regionId}` : participant.kind
  const participantFromValue = (value: string): SwapParticipant =>
    value.startsWith('monitor:')
      ? { kind: 'floating-monitor-region', regionId: value.slice('monitor:'.length) }
      : value === 'webcam'
        ? { kind: 'webcam' }
        : { kind: 'main-screen' }

  useEffect(() => {
    setDurationText((region.transitionDuration ?? 0.3).toFixed(1))
  }, [region.transitionDuration])

  return (
    <div className="space-y-6">
      <div className="space-y-2.5">
        <span className="text-sm font-medium text-sidebar-foreground">Origin</span>
        <Select
          value={participantValue(region.origin)}
          onValueChange={(value) => updateRegion(region.id, { origin: participantFromValue(value) })}
        >
          <SelectTrigger className="h-10 border-border bg-card text-sm shadow-sm">
            <SelectValue placeholder="Escolha a origem" />
          </SelectTrigger>
          <SelectContent>
            {participantOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2.5">
        <span className="text-sm font-medium text-sidebar-foreground">Target</span>
        <Select
          value={participantValue(region.target)}
          onValueChange={(value) => updateRegion(region.id, { target: participantFromValue(value) })}
        >
          <SelectTrigger className="h-10 border-border bg-card text-sm shadow-sm">
            <SelectValue placeholder="Escolha o destino" />
          </SelectTrigger>
          <SelectContent>
            {participantOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Monitor disponível apenas quando cruza este trecho. Origem e destino precisam ser diferentes.
        </p>
      </div>

      <div className="space-y-2.5">
        <span className="text-sm font-medium text-sidebar-foreground">Transition Animation</span>
        <Select
          value={region.transition}
          onValueChange={(value) => updateRegion(region.id, { transition: value as CameraSwapRegion['transition'] })}
        >
          <SelectTrigger className="h-10 text-sm border-border bg-card shadow-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None (Instant)</SelectItem>
            <SelectItem value="fade">Fade</SelectItem>
            <SelectItem value="slide">Slide</SelectItem>
            <SelectItem value="scale">Scale</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {region.transition !== 'none' && (
        <div className="space-y-4 pt-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-sidebar-foreground">Transition Duration (s)</span>
            <input
              type="text"
              inputMode="decimal"
              value={durationText}
              onChange={(e) => {
                const raw = e.target.value.replace(',', '.')
                setDurationText(raw)
                const val = parseFloat(raw)
                if (!isNaN(val) && val >= 0.1 && val <= 2.0) {
                  updateRegion(region.id, { transitionDuration: Number(val.toFixed(1)) })
                }
              }}
              onBlur={() => {
                const val = parseFloat(durationText.replace(',', '.'))
                const clamped = isNaN(val) ? 0.3 : Math.max(0.1, Math.min(2.0, val))
                const rounded = Number(clamped.toFixed(1))
                setDurationText(rounded.toFixed(1))
                updateRegion(region.id, { transitionDuration: rounded })
              }}
              className="w-16 h-8 px-2 text-xs font-semibold text-primary tabular-nums bg-transparent border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary text-right"
            />
          </div>
          <Slider
            min={0.1}
            max={2.0}
            step={0.1}
            value={region.transitionDuration ?? 0.3}
            onChange={(value) => updateRegion(region.id, { transitionDuration: Number(value.toFixed(1)) })}
          />
        </div>
      )}

      <div className="pt-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => deleteRegion(region.id)}
          className="w-full h-10 bg-destructive/10 hover:bg-destructive text-destructive hover:text-destructive-foreground transition-all duration-200 flex items-center gap-2 justify-center font-medium"
        >
          <Trash className="w-4 h-4" />
          <span>Delete Region</span>
        </Button>
      </div>
    </div>
  )
}

function MediaAudioSettings({ region }: { region: MediaAudioRegion }) {
  const { updateRegion, deleteRegion, splitMediaAudioRegion, currentTime, mediaAudioClip } = useEditorStore(
    (state) => ({
      updateRegion: state.updateRegion,
      deleteRegion: state.deleteRegion,
      splitMediaAudioRegion: state.splitMediaAudioRegion,
      currentTime: state.currentTime,
      mediaAudioClip: state.mediaAudioClip,
    }),
  )

  const canSplitAtPlayhead =
    currentTime > region.startTime + 0.1 && currentTime < region.startTime + region.duration - 0.1
  const effectiveVolume = region.isMuted ? 0 : region.volume

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <span className="text-sm font-medium text-sidebar-foreground block">Mute</span>
          <p className="text-xs text-muted-foreground leading-relaxed">Disable media audio for this clip.</p>
        </div>
        <Switch checked={region.isMuted} onCheckedChange={(checked) => updateRegion(region.id, { isMuted: checked })} />
      </div>

      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Volume</span>
          <span className="text-xs font-semibold text-primary tabular-nums">{Math.round(effectiveVolume * 100)}%</span>
        </div>
        <Slider
          min={0}
          max={1}
          step={0.01}
          value={effectiveVolume}
          onChange={(value) => updateRegion(region.id, { volume: Math.max(0, Math.min(value, 1)), isMuted: false })}
          disabled={region.isMuted}
        />
      </div>

      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Fade In</span>
          <span className="text-xs font-semibold text-primary tabular-nums">{region.fadeInDuration.toFixed(2)}s</span>
        </div>
        <Slider
          min={0}
          max={region.duration}
          step={0.01}
          value={region.fadeInDuration}
          onChange={(value) =>
            updateRegion(region.id, { fadeInDuration: Math.max(0, Math.min(value, region.duration)) })
          }
        />
      </div>

      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Fade Out</span>
          <span className="text-xs font-semibold text-primary tabular-nums">{region.fadeOutDuration.toFixed(2)}s</span>
        </div>
        <Slider
          min={0}
          max={region.duration}
          step={0.01}
          value={region.fadeOutDuration}
          onChange={(value) =>
            updateRegion(region.id, { fadeOutDuration: Math.max(0, Math.min(value, region.duration)) })
          }
        />
      </div>

      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Source offset: {region.sourceStart.toFixed(2)}s{mediaAudioClip?.name ? ` • ${mediaAudioClip.name}` : ''}
        </p>
      </div>

      <div className="pt-2 space-y-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() => splitMediaAudioRegion(region.id, currentTime)}
          disabled={!canSplitAtPlayhead}
          className="w-full h-10 border-border bg-card/70 text-foreground hover:bg-accent hover:text-foreground transition-all duration-200 flex items-center gap-2 justify-center font-medium"
        >
          <Scissors className="w-4 h-4" />
          <span>Split at playhead</span>
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={() => deleteRegion(region.id)}
          className="w-full h-10 bg-destructive/10 hover:bg-destructive text-destructive hover:text-destructive-foreground transition-all duration-200 flex items-center gap-2 justify-center font-medium"
        >
          <Trash className="w-4 h-4" />
          <span>Delete Clip</span>
        </Button>
      </div>
    </div>
  )
}

function ChangeSoundSettings({ region }: { region: ChangeSoundRegion }) {
  const { updateRegion, deleteRegion, splitChangeSoundRegion, currentTime, systemAudioUrl } = useEditorStore(
    (state) => ({
      updateRegion: state.updateRegion,
      deleteRegion: state.deleteRegion,
      splitChangeSoundRegion: state.splitChangeSoundRegion,
      currentTime: state.currentTime,
      systemAudioUrl: state.systemAudioUrl,
    }),
  )

  const canSplitAtPlayhead =
    currentTime > region.startTime + 0.1 && currentTime < region.startTime + region.duration - 0.1
  const effectiveVolume = region.isMuted ? 0 : region.volume

  return (
    <div className="space-y-6">
      <div className="space-y-2.5">
        <span className="text-sm font-medium text-sidebar-foreground">Source</span>
        <Select
          value={region.sourceKey}
          onValueChange={(value) => updateRegion(region.id, { sourceKey: value as ChangeSoundRegion['sourceKey'] })}
        >
          <SelectTrigger className="h-10 text-sm border-border bg-card shadow-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="recording-mic">Microfone</SelectItem>
            <SelectItem value="system-audio" disabled={!systemAudioUrl}>
              Computer Audio
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <span className="text-sm font-medium text-sidebar-foreground block">Mute</span>
          <p className="text-xs text-muted-foreground leading-relaxed">Disable this source for the selected region.</p>
        </div>
        <Switch checked={region.isMuted} onCheckedChange={(checked) => updateRegion(region.id, { isMuted: checked })} />
      </div>

      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Volume</span>
          <span className="text-xs font-semibold text-primary tabular-nums">{Math.round(effectiveVolume * 100)}%</span>
        </div>
        <Slider
          min={0}
          max={1}
          step={0.01}
          value={effectiveVolume}
          onChange={(value) => updateRegion(region.id, { volume: Math.max(0, Math.min(value, 1)), isMuted: false })}
          disabled={region.isMuted}
        />
      </div>

      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Fade In</span>
          <span className="text-xs font-semibold text-primary tabular-nums">{region.fadeInDuration.toFixed(2)}s</span>
        </div>
        <Slider
          min={0}
          max={region.duration}
          step={0.01}
          value={region.fadeInDuration}
          onChange={(value) =>
            updateRegion(region.id, { fadeInDuration: Math.max(0, Math.min(value, region.duration)) })
          }
        />
      </div>

      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Fade Out</span>
          <span className="text-xs font-semibold text-primary tabular-nums">{region.fadeOutDuration.toFixed(2)}s</span>
        </div>
        <Slider
          min={0}
          max={region.duration}
          step={0.01}
          value={region.fadeOutDuration}
          onChange={(value) =>
            updateRegion(region.id, { fadeOutDuration: Math.max(0, Math.min(value, region.duration)) })
          }
        />
      </div>

      <div className="pt-2 space-y-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() => splitChangeSoundRegion(region.id, currentTime)}
          disabled={!canSplitAtPlayhead}
          className="w-full h-10 border-border bg-card/70 text-foreground hover:bg-accent hover:text-foreground transition-all duration-200 flex items-center gap-2 justify-center font-medium"
        >
          <Scissors className="w-4 h-4" />
          <span>Split at playhead</span>
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={() => deleteRegion(region.id)}
          className="w-full h-10 bg-destructive/10 hover:bg-destructive text-destructive hover:text-destructive-foreground transition-all duration-200 flex items-center gap-2 justify-center font-medium"
        >
          <Trash className="w-4 h-4" />
          <span>Delete Clip</span>
        </Button>
      </div>
    </div>
  )
}

const MonitorValueSlider = ({
  label,
  value,
  min,
  max,
  step,
  suffix = '',
  displayValue,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  suffix?: string
  displayValue?: string
  onChange: (value: number) => void
}) => (
  <div className="space-y-2.5">
    <div className="flex items-center justify-between">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-xs font-semibold tabular-nums text-violet-500 dark:text-violet-300">
        {displayValue ?? `${value}${suffix}`}
      </span>
    </div>
    <Slider min={min} max={max} step={step} value={value} onChange={onChange} />
  </div>
)

function FloatingMonitorSettings({ region }: { region: FloatingMonitorRegion }) {
  const { monitor, currentTime, updateRegion, deleteRegion } = useEditorStore((state) => ({
    monitor: state.floatingMonitors[region.monitorId],
    currentTime: state.currentTime,
    updateRegion: state.updateRegion,
    deleteRegion: state.deleteRegion,
  }))
  const isStaticImage = monitor?.kind === 'image'
  const sourceTime = isStaticImage ? 0 : Math.max(0, region.sourceStart + currentTime - region.startTime)
  const style = {
    borderRadius: Number.isFinite(region.borderRadius)
      ? region.borderRadius
      : DEFAULTS.FLOATING_MONITOR.STYLE.RADIUS.defaultValue,
    isFlipped: region.isFlipped === true,
    border:
      typeof region.border === 'boolean' ? region.border : DEFAULTS.FLOATING_MONITOR.STYLE.BORDER.ENABLED.defaultValue,
    borderWidth: Number.isFinite(region.borderWidth)
      ? region.borderWidth
      : DEFAULTS.FLOATING_MONITOR.STYLE.BORDER.WIDTH.defaultValue,
    borderColor: region.borderColor || DEFAULTS.FLOATING_MONITOR.STYLE.BORDER.DEFAULT_COLOR_RGBA,
    shadowBlur: Number.isFinite(region.shadowBlur)
      ? region.shadowBlur
      : DEFAULTS.FLOATING_MONITOR.EFFECTS.BLUR.defaultValue,
    shadowOffsetX: Number.isFinite(region.shadowOffsetX)
      ? region.shadowOffsetX
      : DEFAULTS.FLOATING_MONITOR.EFFECTS.OFFSET_X.defaultValue,
    shadowOffsetY: Number.isFinite(region.shadowOffsetY)
      ? region.shadowOffsetY
      : DEFAULTS.FLOATING_MONITOR.EFFECTS.OFFSET_Y.defaultValue,
    shadowColor: region.shadowColor || DEFAULTS.FLOATING_MONITOR.EFFECTS.DEFAULT_COLOR_RGBA,
  }
  const { hex: borderHex, alpha: borderAlpha } = useMemo(() => rgbaToHexAlpha(style.borderColor), [style.borderColor])
  const { hex: shadowHex, alpha: shadowAlpha } = useMemo(() => rgbaToHexAlpha(style.shadowColor), [style.shadowColor])

  const updateCrop = (updates: Partial<FloatingMonitorRegion['crop']>) =>
    updateRegion(region.id, { crop: normalizeWebcamCrop(updates, region.crop) })
  const updateRgbaColor = (hex: string, alpha: number, field: 'borderColor' | 'shadowColor') => {
    const rgb = hexToRgb(hex)
    if (!rgb) return
    updateRegion(region.id, { [field]: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})` })
  }
  const resetStyle = () =>
    updateRegion(region.id, {
      borderRadius: DEFAULTS.FLOATING_MONITOR.STYLE.RADIUS.defaultValue,
      isFlipped: DEFAULTS.FLOATING_MONITOR.STYLE.FLIP.defaultValue,
      border: DEFAULTS.FLOATING_MONITOR.STYLE.BORDER.ENABLED.defaultValue,
      borderWidth: DEFAULTS.FLOATING_MONITOR.STYLE.BORDER.WIDTH.defaultValue,
      borderColor: DEFAULTS.FLOATING_MONITOR.STYLE.BORDER.DEFAULT_COLOR_RGBA,
    })
  const resetCrop = () => updateRegion(region.id, { crop: normalizeWebcamCrop(null) })
  const resetEffects = () =>
    updateRegion(region.id, {
      shadowBlur: DEFAULTS.FLOATING_MONITOR.EFFECTS.BLUR.defaultValue,
      shadowOffsetX: DEFAULTS.FLOATING_MONITOR.EFFECTS.OFFSET_X.defaultValue,
      shadowOffsetY: DEFAULTS.FLOATING_MONITOR.EFFECTS.OFFSET_Y.defaultValue,
      shadowColor: DEFAULTS.FLOATING_MONITOR.EFFECTS.DEFAULT_COLOR_RGBA,
    })

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-violet-500/25 bg-violet-500/5 p-3">
        <p className="text-sm font-medium text-foreground">{monitor?.name || 'Floating monitor'}</p>
        <p className="mt-1 text-xs text-muted-foreground">Arraste no preview. Ajuste layout, estilo, crop e swap.</p>
      </div>
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Source offset</span>
          <span className="text-xs font-semibold text-violet-500 tabular-nums dark:text-violet-300">
            {isStaticImage ? 'Imagem estática' : `${region.sourceStart.toFixed(2)}s`}
          </span>
        </div>
        <Slider
          min={0}
          max={isStaticImage ? 1 : Math.max(0, (monitor?.duration || 0) - region.duration)}
          step={0.01}
          value={isStaticImage ? 0 : region.sourceStart}
          onChange={(value) => updateRegion(region.id, { sourceStart: value })}
          disabled={isStaticImage}
        />
      </div>
      <Collapse title="Layout" description="Posição e tamanho do monitor" defaultOpen>
        <div className="space-y-4">
          {(
            [
              ['x', 'Horizontal position'],
              ['y', 'Vertical position'],
              ['width', 'Width'],
              ['height', 'Height'],
            ] as const
          ).map(([key, label]) => (
            <div key={key} className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{label}</span>
                <span className="font-semibold text-violet-500 dark:text-violet-300">
                  {Math.round(region[key] * 100)}%
                </span>
              </div>
              <Slider
                min={key === 'width' || key === 'height' ? 0.1 : 0}
                max={1}
                step={0.01}
                value={region[key]}
                onChange={(value) => updateRegion(region.id, { [key]: value })}
              />
            </div>
          ))}
        </div>
      </Collapse>
      <Collapse title="Style" description="Borda, cantos e espelhamento" icon={<Square />} onReset={resetStyle}>
        <div className="space-y-5">
          <MonitorValueSlider
            label="Corner radius"
            value={style.borderRadius}
            min={DEFAULTS.FLOATING_MONITOR.STYLE.RADIUS.min}
            max={DEFAULTS.FLOATING_MONITOR.STYLE.RADIUS.max}
            step={DEFAULTS.FLOATING_MONITOR.STYLE.RADIUS.step}
            suffix="%"
            onChange={(borderRadius) => updateRegion(region.id, { borderRadius })}
          />
          <div className="flex items-center justify-between text-sm font-medium text-sidebar-foreground">
            <span className="flex items-center gap-2.5">
              <SquareToggle className="h-4 w-4 text-violet-500 dark:text-violet-300" />
              Flip horizontal
            </span>
            <Switch checked={style.isFlipped} onCheckedChange={(isFlipped) => updateRegion(region.id, { isFlipped })} />
          </div>
          <div className="space-y-4">
            <div className="flex items-center justify-between text-sm font-medium text-sidebar-foreground">
              <span className="flex items-center gap-2.5">
                <Square className="h-4 w-4 text-violet-500 dark:text-violet-300" />
                Border
              </span>
              <Switch checked={style.border} onCheckedChange={(border) => updateRegion(region.id, { border })} />
            </div>
            {style.border && (
              <div className="space-y-4 pl-7">
                <MonitorValueSlider
                  label="Thickness"
                  value={style.borderWidth}
                  min={DEFAULTS.FLOATING_MONITOR.STYLE.BORDER.WIDTH.min}
                  max={DEFAULTS.FLOATING_MONITOR.STYLE.BORDER.WIDTH.max}
                  step={DEFAULTS.FLOATING_MONITOR.STYLE.BORDER.WIDTH.step}
                  suffix="px"
                  onChange={(borderWidth) => updateRegion(region.id, { borderWidth })}
                />
                <div className="grid grid-cols-2 gap-4">
                  <ColorPicker
                    label="Color"
                    value={borderHex}
                    onChange={(value) => updateRgbaColor(value, borderAlpha, 'borderColor')}
                  />
                  <MonitorValueSlider
                    label="Opacity"
                    value={borderAlpha}
                    min={0}
                    max={1}
                    step={0.01}
                    displayValue={`${Math.round(borderAlpha * 100)}%`}
                    onChange={(value) => updateRgbaColor(borderHex, value, 'borderColor')}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </Collapse>
      <Collapse
        title="Crop"
        description="Recorte a fonte pelos pontos do preview"
        icon={<Marquee2 />}
        onReset={resetCrop}
      >
        <div className="space-y-6">
          {monitor && (
            <WebcamCropEditor
              sourceUrl={monitor.url}
              sourceKind={monitor.kind}
              currentTime={sourceTime}
              crop={region.crop}
              onUpdateCrop={updateCrop}
            />
          )}
          <div className="grid grid-cols-2 gap-4">
            {(['top', 'right', 'bottom', 'left'] as const).map((edge) => (
              <MonitorValueSlider
                key={edge}
                label={edge[0].toUpperCase() + edge.slice(1)}
                value={region.crop[edge]}
                min={DEFAULTS.CAMERA.CROP[edge.toUpperCase() as 'TOP' | 'RIGHT' | 'BOTTOM' | 'LEFT'].min}
                max={DEFAULTS.CAMERA.CROP[edge.toUpperCase() as 'TOP' | 'RIGHT' | 'BOTTOM' | 'LEFT'].max}
                step={DEFAULTS.CAMERA.CROP[edge.toUpperCase() as 'TOP' | 'RIGHT' | 'BOTTOM' | 'LEFT'].step}
                displayValue={`${Math.round(region.crop[edge] * 100)}%`}
                onChange={(value) => updateCrop({ [edge]: value })}
              />
            ))}
          </div>
        </div>
      </Collapse>
      <Collapse title="Effects" description="Profundidade da superfície" icon={<Wand />} onReset={resetEffects}>
        <div className="space-y-4">
          <MonitorValueSlider
            label="Blur"
            value={style.shadowBlur}
            min={DEFAULTS.FLOATING_MONITOR.EFFECTS.BLUR.min}
            max={DEFAULTS.FLOATING_MONITOR.EFFECTS.BLUR.max}
            step={DEFAULTS.FLOATING_MONITOR.EFFECTS.BLUR.step}
            suffix="px"
            onChange={(shadowBlur) => updateRegion(region.id, { shadowBlur })}
          />
          <div className="grid grid-cols-2 gap-4">
            <MonitorValueSlider
              label="Offset X"
              value={style.shadowOffsetX}
              min={DEFAULTS.FLOATING_MONITOR.EFFECTS.OFFSET_X.min}
              max={DEFAULTS.FLOATING_MONITOR.EFFECTS.OFFSET_X.max}
              step={DEFAULTS.FLOATING_MONITOR.EFFECTS.OFFSET_X.step}
              suffix="px"
              onChange={(shadowOffsetX) => updateRegion(region.id, { shadowOffsetX })}
            />
            <MonitorValueSlider
              label="Offset Y"
              value={style.shadowOffsetY}
              min={DEFAULTS.FLOATING_MONITOR.EFFECTS.OFFSET_Y.min}
              max={DEFAULTS.FLOATING_MONITOR.EFFECTS.OFFSET_Y.max}
              step={DEFAULTS.FLOATING_MONITOR.EFFECTS.OFFSET_Y.step}
              suffix="px"
              onChange={(shadowOffsetY) => updateRegion(region.id, { shadowOffsetY })}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <ColorPicker
              label="Color"
              value={shadowHex}
              onChange={(value) => updateRgbaColor(value, shadowAlpha, 'shadowColor')}
            />
            <MonitorValueSlider
              label="Opacity"
              value={shadowAlpha}
              min={0}
              max={1}
              step={0.01}
              displayValue={`${Math.round(shadowAlpha * 100)}%`}
              onChange={(value) => updateRgbaColor(shadowHex, value, 'shadowColor')}
            />
          </div>
        </div>
      </Collapse>
      <Button
        variant="outline"
        size="sm"
        onClick={() => deleteRegion(region.id)}
        className="w-full h-10 bg-destructive/10 hover:bg-destructive text-destructive hover:text-destructive-foreground"
      >
        <Trash className="w-4 h-4" />
        <span>Delete monitor clip</span>
      </Button>
    </div>
  )
}

export function RegionSettingsPanel({ region }: RegionSettingsPanelProps) {
  const RegionIcon =
    region.type === 'zoom'
      ? Camera
      : region.type === 'cut'
        ? Scissors
        : region.type === 'speed'
          ? PlayerTrackNext
          : region.type === 'swap'
            ? Refresh
            : region.type === 'media-audio'
              ? Music
              : region.type === 'change-sound'
                ? AdjustmentsHorizontal
                : region.type === 'floating-monitor'
                  ? Video
                  : Search
  const regionColor =
    region.type === 'zoom'
      ? 'text-primary'
      : region.type === 'cut'
        ? 'text-destructive'
        : region.type === 'speed'
          ? 'text-speed-accent'
          : region.type === 'swap'
            ? 'text-orange-500'
            : region.type === 'media-audio'
              ? 'text-emerald-500'
              : region.type === 'change-sound'
                ? 'text-sky-500'
                : region.type === 'floating-monitor'
                  ? 'text-violet-500'
                  : 'text-amber-500'
  const regionBg =
    region.type === 'zoom'
      ? 'bg-primary/10'
      : region.type === 'cut'
        ? 'bg-destructive/10'
        : region.type === 'speed'
          ? 'bg-speed-accent/10'
          : region.type === 'swap'
            ? 'bg-orange-500/10'
            : region.type === 'media-audio'
              ? 'bg-emerald-500/10'
              : region.type === 'change-sound'
                ? 'bg-sky-500/10'
                : region.type === 'floating-monitor'
                  ? 'bg-violet-500/10'
                  : 'bg-amber-500/10'

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-6 border-b border-sidebar-border flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center', regionBg)}>
            <RegionIcon className={cn('w-5 h-5', regionColor)} />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-sidebar-foreground capitalize">{region.type} Region</h2>
            <p className="text-sm text-muted-foreground">
              {region.type === 'zoom'
                ? 'Zoom and pan controls'
                : region.type === 'cut'
                  ? 'Cut segment settings'
                  : region.type === 'speed'
                    ? 'Playback speed controls'
                    : region.type === 'swap'
                      ? 'Camera swap settings'
                      : region.type === 'media-audio'
                        ? 'Audio clip trim, split, and fades'
                        : region.type === 'change-sound'
                          ? 'Recording audio mix controls'
                          : region.type === 'floating-monitor'
                            ? 'Floating video monitor controls'
                            : 'Blur asset controls'}
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 p-6 space-y-6 overflow-y-auto">
        {/* Zoom-specific Controls */}
        {region.type === 'zoom' && <ZoomSettings region={region} />}

        {/* Blur-specific Controls */}
        {region.type === 'blur' && <BlurSettings region={region} />}

        {/* Speed-specific Controls */}
        {region.type === 'speed' && <SpeedSettings region={region as SpeedRegion} />}

        {/* Swap-specific Controls */}
        {region.type === 'swap' && <SwapSettings region={region} />}

        {/* Media Audio Controls */}
        {region.type === 'media-audio' && <MediaAudioSettings region={region} />}

        {/* Change Sound Controls */}
        {region.type === 'change-sound' && <ChangeSoundSettings region={region} />}

        {region.type === 'floating-monitor' && <FloatingMonitorSettings region={region} />}

        {/* Cut Region Info */}
        {region.type === 'cut' && (
          <div className="p-4 bg-destructive/5 border border-destructive/20 rounded-lg">
            <div className="flex items-start gap-3">
              <Scissors className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-foreground mb-1">Cut Segment</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  This portion will be removed from the final video
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
