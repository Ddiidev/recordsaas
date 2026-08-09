import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'

import { useEditorStore } from '../../../store/editorStore'
import { Button } from '../../ui/button'
import { Input } from '../../ui/input'
import { Switch } from '../../ui/switch'

export function TakeModeSettings() {
  const { takeModeEnabled, takes, takeTransitions, sourceDuration, setTakeModeEnabled, initializeTakes } =
    useEditorStore(
      useShallow((state) => ({
        takeModeEnabled: state.takeModeEnabled,
        takes: state.takes,
        takeTransitions: state.takeTransitions,
        sourceDuration: state.sourceDuration || state.duration,
        setTakeModeEnabled: state.setTakeModeEnabled,
        initializeTakes: state.initializeTakes,
      })),
    )

  return (
    <section className="rounded-xl border border-border bg-muted/25 p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Take Mode</h3>
          <p className="mt-1 text-xs text-muted-foreground">Edit the main recording as ripple clips.</p>
        </div>
        <Switch
          checked={takeModeEnabled}
          disabled={sourceDuration <= 0}
          onCheckedChange={(enabled) => setTakeModeEnabled(enabled)}
          aria-label="Enable Take Mode"
        />
      </div>
      {takeModeEnabled && (
        <div className="mt-3 flex items-center justify-between border-t border-border/60 pt-3">
          <span className="text-xs text-muted-foreground">
            {takes.length} {takes.length === 1 ? 'take' : 'takes'} · {takeTransitions.length} transitions
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (takes.length > 1 || takeTransitions.length > 0) {
                const confirmed = window.confirm('Reset all take edits to one full recording take?')
                if (!confirmed) return
              }
              initializeTakes([])
            }}
          >
            Reset edits
          </Button>
        </div>
      )}
    </section>
  )
}

export function TakeSettingsPanel({ takeId }: { takeId: string }) {
  const {
    take,
    takeIndex,
    takeCount,
    sourceDuration,
    webcamVideoUrl,
    floatingMonitors,
    updateTake,
    renameTake,
    moveTake,
    duplicateTake,
    replaceTake,
    deleteTake,
  } = useEditorStore(
    useShallow((state) => {
      const index = state.takes.findIndex((candidate) => candidate.id === takeId)
      return {
        take: state.takes[index],
        takeIndex: index,
        takeCount: state.takes.length,
        sourceDuration: state.sourceDuration,
        webcamVideoUrl: state.webcamVideoUrl,
        floatingMonitors: state.floatingMonitors,
        updateTake: state.updateTake,
        renameTake: state.renameTake,
        moveTake: state.moveTake,
        duplicateTake: state.duplicateTake,
        replaceTake: state.replaceTake,
        deleteTake: state.deleteTake,
      }
    }),
  )
  const importedVideos = useMemo(
    () => Object.values(floatingMonitors).filter((monitor) => monitor.kind === 'video' && !monitor.isEditedCopy),
    [floatingMonitors],
  )

  if (!take) return null

  const sourceValue =
    take.source.kind === 'recording-screen'
      ? 'screen'
      : take.source.kind === 'recording-webcam'
        ? 'webcam'
        : `asset:${take.source.assetId}`

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-sidebar-border p-6">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Take {takeIndex + 1}</p>
        <h2 className="mt-1 text-lg font-semibold text-sidebar-foreground">Take Settings</h2>
        <p className="mt-1 text-sm text-muted-foreground">Ripple edit and replace this source clip.</p>
      </div>
      <div className="stable-scrollbar flex-1 space-y-5 overflow-y-auto p-6">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Name</span>
          <Input value={take.name || ''} onChange={(event) => renameTake(take.id, event.target.value)} />
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Source</span>
          <select
            value={sourceValue}
            onChange={(event) => {
              const value = event.target.value
              if (value === 'screen') {
                replaceTake(take.id, { kind: 'recording-screen' }, sourceDuration, 'session')
              } else if (value === 'webcam') {
                replaceTake(take.id, { kind: 'recording-webcam' }, sourceDuration, 'session')
              } else if (value.startsWith('asset:')) {
                const assetId = value.slice('asset:'.length)
                const monitor = floatingMonitors[assetId]
                if (monitor) replaceTake(take.id, { kind: 'imported-video', assetId }, monitor.duration, 'source')
              }
            }}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="screen">Recording screen</option>
            <option value="webcam" disabled={!webcamVideoUrl}>
              Recording webcam
            </option>
            {importedVideos.map((monitor) => (
              <option key={monitor.id} value={`asset:${monitor.id}`}>
                {monitor.name}
              </option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">In</span>
            <Input
              type="number"
              min={0}
              step={0.01}
              value={Number(take.sourceStart.toFixed(3))}
              onChange={(event) => updateTake(take.id, { sourceStart: Number(event.target.value) })}
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Out</span>
            <Input
              type="number"
              min={0.1}
              step={0.01}
              value={Number((take.sourceStart + take.duration).toFixed(3))}
              onChange={(event) =>
                updateTake(take.id, { duration: Math.max(0.1, Number(event.target.value) - take.sourceStart) })
              }
            />
          </label>
        </div>

        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Duration</span>
          <Input
            type="number"
            min={0.1}
            step={0.01}
            value={Number(take.duration.toFixed(3))}
            onChange={(event) => updateTake(take.id, { duration: Number(event.target.value) })}
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Audio</span>
          <select
            value={take.audioMode}
            onChange={(event) => updateTake(take.id, { audioMode: event.target.value as typeof take.audioMode })}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="session">Session mic / PC audio</option>
            <option
              value="source"
              disabled={
                take.source.kind !== 'imported-video' || floatingMonitors[take.source.assetId]?.hasAudioTrack !== true
              }
            >
              Embedded source audio
            </option>
            <option value="none">None</option>
          </select>
        </label>

        {take.audioMode === 'session' && (
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Session audio start</span>
            <Input
              type="number"
              min={0}
              step={0.01}
              value={Number((take.sessionAudioStart || 0).toFixed(3))}
              onChange={(event) => updateTake(take.id, { sessionAudioStart: Number(event.target.value) })}
            />
          </label>
        )}

        <div className="space-y-2 rounded-lg border border-border bg-muted/25 p-3">
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>Mute</span>
            <Switch checked={take.isMuted} onCheckedChange={(isMuted) => updateTake(take.id, { isMuted })} />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs text-muted-foreground">Volume {Math.round(take.volume * 100)}%</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={take.volume}
              onChange={(event) => updateTake(take.id, { volume: Number(event.target.value) })}
              className="w-full accent-primary"
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={() => moveTake(take.id, 'left')} disabled={takeIndex <= 0}>
            Move left
          </Button>
          <Button variant="outline" onClick={() => moveTake(take.id, 'right')} disabled={takeIndex >= takeCount - 1}>
            Move right
          </Button>
          <Button variant="outline" onClick={() => duplicateTake(take.id)}>
            Duplicate
          </Button>
          <Button variant="destructive" onClick={() => deleteTake(take.id)} disabled={takeCount <= 1}>
            Delete
          </Button>
        </div>
      </div>
    </div>
  )
}
