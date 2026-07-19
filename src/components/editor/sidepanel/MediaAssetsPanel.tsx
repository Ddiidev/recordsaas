import { useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  FileImport,
  Music,
  AdjustmentsHorizontal,
  type IconComponent,
  IconShell,
  IconSwitch,
  MusicNoteSolid,
  Photo,
  Video,
  Upload,
  Trash,
  GripVertical,
} from '@icons'
import { useEditorStore } from '../../../store/editorStore'
import { cn, formatTime } from '../../../lib/utils'
import { Button } from '../../ui/button'
import { CHANGE_SOUND_DRAG_TYPE, MEDIA_AUDIO_DRAG_TYPE } from '../../../lib/media-assets'

type MediaCategory = 'audio' | 'image' | 'video'

const categoryConfig: Array<{
  id: MediaCategory
  label: string
  icon: IconComponent
  solid?: IconComponent
}> = [
  { id: 'audio', label: 'Audio', icon: Music, solid: MusicNoteSolid },
  { id: 'image', label: 'Image', icon: Photo },
  { id: 'video', label: 'Video', icon: Video },
]

export function MediaAssetsPanel() {
  const [activeCategory, setActiveCategory] = useState<MediaCategory>('audio')
  const [isImporting, setIsImporting] = useState(false)
  const [isImportingVideo, setIsImportingVideo] = useState(false)
  const [isImportingImage, setIsImportingImage] = useState(false)

  const {
    currentTime,
    mediaAudioClip,
    mediaAudioRegions,
    setMediaAudioClip,
    addMediaAudioRegion,
    addChangeSoundRegion,
    clearMediaAudioClip,
    floatingMonitors,
    addFloatingMonitor,
    updateFloatingMonitor,
    removeFloatingMonitor,
    addFloatingMonitorRegion,
    beginAssetTimelineEdit,
  } = useEditorStore(
    useShallow((state) => ({
      currentTime: state.currentTime,
      mediaAudioClip: state.mediaAudioClip,
      mediaAudioRegions: state.mediaAudioRegions,
      setMediaAudioClip: state.setMediaAudioClip,
      addMediaAudioRegion: state.addMediaAudioRegion,
      addChangeSoundRegion: state.addChangeSoundRegion,
      clearMediaAudioClip: state.clearMediaAudioClip,
      floatingMonitors: state.floatingMonitors,
      addFloatingMonitor: state.addFloatingMonitor,
      updateFloatingMonitor: state.updateFloatingMonitor,
      removeFloatingMonitor: state.removeFloatingMonitor,
      addFloatingMonitorRegion: state.addFloatingMonitorRegion,
      beginAssetTimelineEdit: state.beginAssetTimelineEdit,
    })),
  )

  const mediaDurationLabel = useMemo(() => {
    if (!mediaAudioClip) return '--:--'
    if (mediaAudioClip.duration <= 0) return 'Loading...'
    return formatTime(mediaAudioClip.duration, true)
  }, [mediaAudioClip])

  const handleImportAudio = async () => {
    try {
      setIsImporting(true)
      const result = await window.electronAPI.importMediaAudioAsset()
      if (result.canceled || !result.asset) return

      setMediaAudioClip({
        path: result.asset.path,
        name: result.asset.name,
        startTime: 0,
        duration: 0,
      })
      addMediaAudioRegion({ startTime: 0 })
    } catch (error) {
      console.error('Failed to import media audio asset:', error)
    } finally {
      setIsImporting(false)
    }
  }

  const handleDragStart = (event: React.DragEvent<HTMLDivElement>) => {
    if (!mediaAudioClip) return
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData(MEDIA_AUDIO_DRAG_TYPE, mediaAudioClip.id)
  }

  const handlePlaceAtPlayhead = () => {
    if (!mediaAudioClip) return
    addMediaAudioRegion({ startTime: currentTime })
  }

  const handleChangeSoundDragStart = (event: React.DragEvent<HTMLDivElement>) => {
    event.dataTransfer.effectAllowed = 'copy'
    event.dataTransfer.setData(CHANGE_SOUND_DRAG_TYPE, 'change-sound')
  }

  const handleImportVideo = async () => {
    try {
      setIsImportingVideo(true)
      const result = await window.electronAPI.importMediaVideoAsset()
      if (result.asset) addFloatingMonitor(result.asset)
    } catch (error) {
      console.error('Failed to import media video asset:', error)
    } finally {
      setIsImportingVideo(false)
    }
  }

  const handleImportImage = async () => {
    try {
      setIsImportingImage(true)
      const result = await window.electronAPI.importMediaImageAsset()
      if (result.asset) addFloatingMonitor({ ...result.asset, kind: 'image' })
    } catch (error) {
      console.error('Failed to import media image asset:', error)
    } finally {
      setIsImportingImage(false)
    }
  }

  const handlePlaceChangeSoundAtPlayhead = () => {
    addChangeSoundRegion({ startTime: currentTime })
  }

  const renderCategoryContent = () => {
    if (activeCategory === 'video' || activeCategory === 'image') {
      const isVideo = activeCategory === 'video'
      const visualAssets = Object.values(floatingMonitors).filter((monitor) => (monitor.kind || 'video') === activeCategory)
      return (
        <div className="space-y-3">
          <Button
            onClick={isVideo ? handleImportVideo : handleImportImage}
            disabled={isVideo ? isImportingVideo : isImportingImage}
            className="icon-hover w-full justify-center gap-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Upload className={cn('h-4 w-4', (isVideo ? isImportingVideo : isImportingImage) && 'animate-pulse')} />
            {isVideo ? (isImportingVideo ? 'Importing...' : 'Import Video') : (isImportingImage ? 'Importing...' : 'Import Image')}
          </Button>

          {visualAssets.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-6 text-center">
              <p className="text-sm font-medium text-foreground">No {isVideo ? 'video' : 'image'} assets</p>
              <p className="mt-1 text-xs text-muted-foreground">Import {isVideo ? 'a video and edit its timeline' : 'an image'}, then add it as a monitor.</p>
            </div>
          ) : (
            visualAssets.map((monitor) => (
              <div key={monitor.id} className="rounded-lg border border-violet-500/30 bg-violet-500/5 p-3">
                <div className="flex items-start gap-2">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-violet-500/30 bg-violet-500/10 text-violet-500">
                    <Video className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">{monitor.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {monitor.duration > 0 ? formatTime(monitor.duration, true) : 'Loading duration...'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeFloatingMonitor(monitor.id)}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    aria-label={`Remove ${monitor.name}`}
                  >
                    <Trash className="h-4 w-4" />
                  </button>
                </div>
                {isVideo ? (
                  <video
                    src={monitor.url}
                    muted
                    preload="metadata"
                    onLoadedMetadata={(event) => {
                      const duration = event.currentTarget.duration
                      if (Number.isFinite(duration) && duration > 0 && duration !== monitor.duration) {
                        updateFloatingMonitor(monitor.id, { duration, timelineDuration: monitor.timelineDuration > 0 ? monitor.timelineDuration : duration })
                      }
                    }}
                    className="mt-3 aspect-video w-full rounded-md bg-black object-cover"
                  />
                ) : (
                  <img src={monitor.url} alt="" className="mt-3 aspect-video w-full rounded-md bg-black object-cover" />
                )}
                <Button
                  variant="outline"
                  onClick={() => beginAssetTimelineEdit(monitor.id)}
                  className="mt-3 w-full gap-2 border-violet-500/30 hover:bg-violet-500/10"
                >
                  <Video className="h-4 w-4 text-violet-500" />
                  Edit in timeline
                </Button>
                <Button
                  variant="outline"
                  onClick={() => addFloatingMonitorRegion(monitor.id, { startTime: currentTime })}
                  disabled={monitor.timelineDuration <= 0}
                  className="mt-2 w-full gap-2 border-violet-500/30 hover:bg-violet-500/10"
                >
                  Add monitor to main timeline
                </Button>
              </div>
            ))
          )}
        </div>
      )
    }

    return (
      <div className="space-y-4">
        <div
          draggable
          onDragStart={handleChangeSoundDragStart}
          onDoubleClick={handlePlaceChangeSoundAtPlayhead}
          className="group cursor-grab rounded-lg border border-sky-500/30 bg-sky-500/5 px-3 py-3 active:cursor-grabbing"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-2">
              <GripVertical className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">Change Sound</p>
                <p className="text-xs text-muted-foreground">Controls microphone audio by region.</p>
              </div>
            </div>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-sky-500/30 bg-sky-500/10 text-sky-500">
              <AdjustmentsHorizontal className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Drag to a timeline lane to add a change-sound region. Double-click to add at current playhead.
          </p>
        </div>

        <Button
          onClick={handleImportAudio}
          disabled={isImporting}
          className="icon-hover w-full justify-center gap-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Upload className={cn('h-4 w-4', isImporting && 'animate-pulse')} />
          {isImporting ? 'Importing...' : 'Import Audio'}
        </Button>

        {!mediaAudioClip ? (
          <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-6 text-center">
            <p className="text-sm font-medium text-foreground">No media audio clip</p>
            <p className="mt-1 text-xs text-muted-foreground">Import one and drag it to the timeline.</p>
          </div>
        ) : (
          <div
            draggable
            onDragStart={handleDragStart}
            onDoubleClick={handlePlaceAtPlayhead}
            className="group cursor-grab rounded-lg border border-primary/30 bg-primary/5 px-3 py-3 active:cursor-grabbing"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-2">
                <GripVertical className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">{mediaAudioClip.name}</p>
                  <p className="text-xs text-muted-foreground">Duration: {mediaDurationLabel}</p>
                  <p className="text-xs text-muted-foreground">
                    Clips on timeline: {Object.keys(mediaAudioRegions).length}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  clearMediaAudioClip()
                }}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                aria-label="Remove imported audio"
              >
                <Trash className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Drag to a timeline lane to add a clip. Double-click to add at current playhead.
            </p>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="p-6 border-b border-sidebar-border flex-shrink-0">
        <div className="flex items-center gap-3">
          <IconShell active className="h-10 w-10">
            <FileImport className="h-5 w-5" />
          </IconShell>
          <div>
            <h2 className="text-lg font-semibold text-sidebar-foreground">Media Assets</h2>
            <p className="text-sm text-muted-foreground">Import and place media on the timeline</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto stable-scrollbar p-6">
        <div className="mb-4 grid grid-cols-3 gap-2 rounded-lg border border-border bg-muted/10 p-1">
          {categoryConfig.map((category) => (
            <button
              key={category.id}
              type="button"
              onClick={() => setActiveCategory(category.id)}
              className={cn(
                'icon-hover flex items-center justify-center gap-1.5 rounded-md px-2 py-2 text-xs font-semibold transition-all duration-150',
                activeCategory === category.id
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              <span className="flex h-7 w-7 items-center justify-center">
                <IconSwitch
                  regular={category.icon}
                  solid={category.solid}
                  active={activeCategory === category.id}
                  className="h-4 w-4"
                />
              </span>
              <span>{category.label}</span>
            </button>
          ))}
        </div>

        {renderCategoryContent()}
      </div>
    </div>
  )
}
