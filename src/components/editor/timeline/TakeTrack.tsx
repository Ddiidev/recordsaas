import { useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'

import { useEditorStore } from '../../../store/editorStore'
import { cn } from '../../../lib/utils'
import { Scissors } from '@icons'
import { TAKE_MIN_DURATION, TAKE_TRANSITION_DEFAULT_DURATION, positionTakes } from '../../../lib/takes'
import type { TakeClip, TakeTransition, TakeTransitionType } from '../../../types'
import { ContextMenu, ContextMenuDivider, ContextMenuItem, ContextMenuLabel } from '../../ui/context-menu'

const TAKE_TRACK_HEIGHT = 64

const TRANSITION_OPTIONS: Array<{ type: TakeTransitionType; label: string }> = [
  { type: 'dissolve', label: 'Dissolve' },
  { type: 'dip-black', label: 'Fade to Black' },
  { type: 'slide-left', label: 'Slide Left' },
  { type: 'slide-right', label: 'Slide Right' },
  { type: 'zoom', label: 'Zoom' },
]

const getSourceLabel = (take: TakeClip): string => {
  if (take.source.kind === 'recording-screen') return 'Screen'
  if (take.source.kind === 'recording-webcam') return 'Webcam'
  return 'Imported'
}

export function TakeTrack({
  timeToTrackPx,
  pixelsPerSecond,
  topOffset = 0,
}: {
  timeToTrackPx: (time: number) => number
  pixelsPerSecond: number
  topOffset?: number
}) {
  const {
    takeModeEnabled,
    takes,
    takeTransitions,
    selectedTakeId,
    currentTime,
    assetTimelineEditing,
    selectTake,
    splitTake,
    trimTake,
    setTakeTransition,
  } = useEditorStore(
    useShallow((state) => ({
      takeModeEnabled: state.takeModeEnabled,
      takes: state.takes,
      takeTransitions: state.takeTransitions,
      selectedTakeId: state.selectedTakeId,
      currentTime: state.currentTime,
      assetTimelineEditing: state.assetTimelineEditing,
      selectTake: state.selectTake,
      splitTake: state.splitTake,
      trimTake: state.trimTake,
      setTakeTransition: state.setTakeTransition,
    })),
  )
  const [transitionMenu, setTransitionMenu] = useState<{
    from: TakeClip
    to: TakeClip
    position: { x: number; y: number }
  } | null>(null)
  const positioned = useMemo(() => positionTakes(takes, takeTransitions), [takes, takeTransitions])

  if (!takeModeEnabled || assetTimelineEditing || takes.length === 0) return null

  const beginTrim = (event: React.MouseEvent, takeId: string, edge: 'start' | 'end') => {
    event.preventDefault()
    event.stopPropagation()
    selectTake(takeId)
    let previousClientX = event.clientX
    const handleMove = (moveEvent: MouseEvent) => {
      const delta = (moveEvent.clientX - previousClientX) / Math.max(1, pixelsPerSecond)
      previousClientX = moveEvent.clientX
      trimTake(takeId, edge, delta)
    }
    const handleUp = () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
  }

  const activeBoundaryTransition = transitionMenu
    ? takeTransitions.find(
        (transition) =>
          transition.fromTakeId === transitionMenu.from.id && transition.toTakeId === transitionMenu.to.id,
      )
    : undefined

  const upsertTransition = (updates: Partial<TakeTransition>) => {
    if (!transitionMenu) return
    const current: TakeTransition = activeBoundaryTransition || {
      fromTakeId: transitionMenu.from.id,
      toTakeId: transitionMenu.to.id,
      type: 'dissolve',
      duration: TAKE_TRANSITION_DEFAULT_DURATION,
      audioMode:
        transitionMenu.from.audioMode === 'source' || transitionMenu.to.audioMode === 'source' ? 'crossfade' : 'cut',
    }
    setTakeTransition({ ...current, ...updates })
  }

  return (
    <>
      <div
        data-take-control
        className="sticky top-0 z-[320] border-b border-border/50 bg-card/95 backdrop-blur-md"
        style={{ height: TAKE_TRACK_HEIGHT, top: topOffset }}
      >
        <div className="absolute left-2 top-2 rounded bg-muted/80 px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
          Takes
        </div>
        {positioned.map(({ take, start, transitionInDuration }, index) => {
          const isSelected = selectedTakeId === take.id
          const left = timeToTrackPx(start)
          const width = Math.max(2, take.duration * pixelsPerSecond)
          const previous = takes[index - 1]
          const transition = previous
            ? takeTransitions.find(
                (candidate) => candidate.fromTakeId === previous.id && candidate.toTakeId === take.id,
              )
            : undefined
          const canSplitAtPlayhead =
            isSelected &&
            currentTime > start + TAKE_MIN_DURATION &&
            currentTime < start + take.duration - TAKE_MIN_DURATION
          return (
            <div key={take.id}>
              <button
                type="button"
                data-take-id={take.id}
                onClick={(event) => {
                  event.stopPropagation()
                  selectTake(take.id)
                }}
                className={cn(
                  'group absolute top-1 h-14 overflow-hidden rounded-md border bg-muted/65 text-left transition-colors',
                  isSelected
                    ? 'border-primary bg-primary/10 ring-1 ring-primary/25'
                    : 'border-border/60 hover:border-primary/50 hover:bg-accent/45',
                )}
                style={{ left: left + 1, width: Math.max(1, width - 2) }}
              >
                <span
                  className="absolute inset-y-0 left-0 z-20 w-2 cursor-ew-resize opacity-0 group-hover:opacity-100"
                  onMouseDown={(event) => beginTrim(event, take.id, 'start')}
                />
                <span
                  className="absolute inset-y-0 right-0 z-20 w-2 cursor-ew-resize opacity-0 group-hover:opacity-100"
                  onMouseDown={(event) => beginTrim(event, take.id, 'end')}
                />
                <span className="flex h-full min-w-0 flex-col justify-center px-3">
                  <span className="truncate text-[11px] font-semibold text-foreground">
                    {take.name || `Take ${index + 1}`}
                  </span>
                  <span className="mt-0.5 truncate text-[9px] text-muted-foreground">
                    {getSourceLabel(take)} · {take.duration.toFixed(2)}s
                  </span>
                </span>
              </button>
              {isSelected && (
                <button
                  type="button"
                  data-take-control
                  aria-label="Split take at playhead"
                  title="Split take at playhead (S)"
                  disabled={!canSplitAtPlayhead}
                  onClick={(event) => {
                    event.stopPropagation()
                    if (canSplitAtPlayhead) splitTake(take.id, currentTime - start)
                  }}
                  className={cn(
                    'absolute top-2 z-30 flex h-7 w-7 items-center justify-center rounded-md border bg-card/95 shadow-sm transition-colors',
                    canSplitAtPlayhead
                      ? 'border-primary/70 text-primary hover:bg-primary hover:text-primary-foreground'
                      : 'cursor-not-allowed border-border/50 text-muted-foreground/40',
                  )}
                  style={{ left: left + Math.max(4, width - 34) }}
                >
                  <Scissors className="h-3.5 w-3.5" />
                </button>
              )}
              {previous && (
                <button
                  type="button"
                  data-take-control
                  aria-label={`Transition from ${previous.name || `Take ${index}`} to ${take.name || `Take ${index + 1}`}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    setTransitionMenu({
                      from: previous,
                      to: take,
                      position: { x: event.clientX, y: event.clientY + 8 },
                    })
                  }}
                  className={cn(
                    'absolute top-5 z-30 h-6 -translate-x-1/2 rounded-full border px-2 text-[9px] font-semibold shadow-sm',
                    transition
                      ? 'border-primary/70 bg-primary text-primary-foreground'
                      : 'border-border bg-card text-muted-foreground hover:border-primary/60 hover:text-foreground',
                  )}
                  style={{ left }}
                >
                  {transition ? `${transition.type} ${transitionInDuration.toFixed(1)}s` : 'Cut'}
                </button>
              )}
            </div>
          )
        })}
      </div>

      <ContextMenu
        isOpen={Boolean(transitionMenu)}
        onClose={() => setTransitionMenu(null)}
        position={transitionMenu?.position || { x: 0, y: 0 }}
        className="w-64"
      >
        <ContextMenuLabel>Transition</ContextMenuLabel>
        {TRANSITION_OPTIONS.map((option) => (
          <ContextMenuItem
            key={option.type}
            className={activeBoundaryTransition?.type === option.type ? 'bg-accent' : undefined}
            onClick={() => upsertTransition({ type: option.type })}
          >
            {option.label}
          </ContextMenuItem>
        ))}
        <ContextMenuDivider />
        <div className="space-y-2 px-3 py-2 text-xs text-popover-foreground">
          <label className="flex items-center justify-between gap-3">
            <span>Duration</span>
            <input
              type="number"
              min={0.1}
              max={2}
              step={0.1}
              value={activeBoundaryTransition?.duration || TAKE_TRANSITION_DEFAULT_DURATION}
              onChange={(event) => upsertTransition({ duration: Number(event.target.value) })}
              className="h-7 w-20 rounded border border-input bg-background px-2 text-right text-foreground outline-none focus:border-ring"
            />
          </label>
          <label className="flex items-center justify-between gap-3">
            <span>Audio</span>
            <select
              value={activeBoundaryTransition?.audioMode || 'cut'}
              onChange={(event) => upsertTransition({ audioMode: event.target.value as 'cut' | 'crossfade' })}
              className="h-7 rounded border border-input bg-background px-2 text-foreground outline-none"
            >
              <option value="cut">Cut</option>
              <option value="crossfade">Crossfade</option>
            </select>
          </label>
        </div>
        <ContextMenuDivider />
        <ContextMenuItem
          disabled={!activeBoundaryTransition}
          onClick={() => {
            if (!transitionMenu) return
            setTakeTransition(null, { fromTakeId: transitionMenu.from.id, toTakeId: transitionMenu.to.id })
          }}
        >
          Remove transition
        </ContextMenuItem>
      </ContextMenu>
    </>
  )
}

export { TAKE_TRACK_HEIGHT }
