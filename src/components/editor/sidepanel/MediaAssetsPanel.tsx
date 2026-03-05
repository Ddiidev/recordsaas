import { useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  FileImport,
  Music,
  AdjustmentsHorizontal,
  Photo,
  Video,
  Upload,
  Trash,
  GripVertical,
} from 'tabler-icons-react'
import { useEditorStore } from '../../../store/editorStore'
import { cn, formatTime } from '../../../lib/utils'
import { Button } from '../../ui/button'
import { CHANGE_SOUND_DRAG_TYPE, MEDIA_AUDIO_DRAG_TYPE } from '../../../lib/media-assets'

type MediaCategory = 'audio' | 'image' | 'video'

const categoryConfig: Array<{ id: MediaCategory; label: string; icon: React.ReactNode }> = [
  { id: 'audio', label: 'Audio', icon: <Music className="h-4 w-4" /> },
  { id: 'image', label: 'Image', icon: <Photo className="h-4 w-4" /> },
  { id: 'video', label: 'Video', icon: <Video className="h-4 w-4" /> },
]

const PlaceholderCategory = ({ icon, title, message }: { icon: React.ReactNode; title: string; message: string }) => (
  <div className="rounded-xl border border-border bg-card/60 p-5 text-center">
    <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-muted/60 text-muted-foreground">
      {icon}
    </div>
    <p className="text-sm font-semibold text-foreground">{title}</p>
    <p className="mt-1 text-xs text-muted-foreground">{message}</p>
  </div>
)

export function MediaAssetsPanel() {
  const [activeCategory, setActiveCategory] = useState<MediaCategory>('audio')
  const [isImporting, setIsImporting] = useState(false)

  const {
    currentTime,
    mediaAudioClip,
    mediaAudioRegions,
    setMediaAudioClip,
    addMediaAudioRegion,
    addChangeSoundRegion,
    clearMediaAudioClip,
  } = useEditorStore(
    useShallow((state) => ({
      currentTime: state.currentTime,
      mediaAudioClip: state.mediaAudioClip,
      mediaAudioRegions: state.mediaAudioRegions,
      setMediaAudioClip: state.setMediaAudioClip,
      addMediaAudioRegion: state.addMediaAudioRegion,
      addChangeSoundRegion: state.addChangeSoundRegion,
      clearMediaAudioClip: state.clearMediaAudioClip,
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

  const handlePlaceChangeSoundAtPlayhead = () => {
    addChangeSoundRegion({ startTime: currentTime })
  }

  const renderCategoryContent = () => {
    if (activeCategory === 'image') {
      return (
        <PlaceholderCategory
          icon={<Photo className="h-5 w-5" />}
          title="Image Assets"
          message="Coming soon. This category is part of the Media foundation."
        />
      )
    }

    if (activeCategory === 'video') {
      return (
        <PlaceholderCategory
          icon={<Video className="h-5 w-5" />}
          title="Video Assets"
          message="Coming soon. This category is part of the Media foundation."
        />
      )
    }

    return (
      <div className="space-y-4">
        <div
          draggable
          onDragStart={handleChangeSoundDragStart}
          onDoubleClick={handlePlaceChangeSoundAtPlayhead}
          className="group cursor-grab rounded-xl border border-sky-500/30 bg-sky-500/5 px-3 py-3 active:cursor-grabbing"
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
          className="w-full justify-center gap-2 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Upload className={cn('h-4 w-4', isImporting && 'animate-pulse')} />
          {isImporting ? 'Importing...' : 'Import Audio'}
        </Button>

        {!mediaAudioClip ? (
          <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-6 text-center">
            <p className="text-sm font-medium text-foreground">No media audio clip</p>
            <p className="mt-1 text-xs text-muted-foreground">Import one and drag it to the timeline.</p>
          </div>
        ) : (
          <div
            draggable
            onDragStart={handleDragStart}
            onDoubleClick={handlePlaceAtPlayhead}
            className="group cursor-grab rounded-xl border border-primary/30 bg-primary/5 px-3 py-3 active:cursor-grabbing"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-2">
                <GripVertical className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">{mediaAudioClip.name}</p>
                  <p className="text-xs text-muted-foreground">Duration: {mediaDurationLabel}</p>
                  <p className="text-xs text-muted-foreground">Clips on timeline: {Object.keys(mediaAudioRegions).length}</p>
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
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <FileImport className="w-5 h-5 text-primary" />
          </div>
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
                'flex items-center justify-center gap-1.5 rounded-md px-2 py-2 text-xs font-semibold transition-colors',
                activeCategory === category.id
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              {category.icon}
              <span>{category.label}</span>
            </button>
          ))}
        </div>

        {renderCategoryContent()}
      </div>
    </div>
  )
}
