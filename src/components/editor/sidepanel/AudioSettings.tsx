import { useEditorStore } from '../../../store/editorStore'
import { useShallow } from 'zustand/react/shallow'
import {
  Microphone,
  Volume,
  Volume2 as MinVolume,
  Volume as MaxVolume,
  Volume3 as MuteVolume,
  MicrophoneOff,
  Clock,
} from '@icons'
import { Collapse } from '../../ui/collapse'
import { Slider } from '../../ui/slider'
import { Button } from '../../ui/button'
import { cn } from '../../../lib/utils'
import { DEFAULTS } from '../../../lib/constants'

const SYNC_OFFSET = { min: -2000, max: 2000, step: 10, defaultValue: 0 }

const SyncOffsetControl = ({
  label,
  offsetMs,
  onChange,
  onReset,
}: {
  label: string
  offsetMs: number
  onChange: (offsetMs: number) => void
  onReset: () => void
}) => (
  <div className="space-y-2">
    <div className="flex items-center gap-2">
      <Clock className="w-4 h-4 text-muted-foreground" />
      <span className="text-sm font-medium text-foreground">{label}</span>
      <span className="ml-auto text-xs font-semibold text-primary tabular-nums">
        {offsetMs > 0 ? '+' : ''}
        {offsetMs} ms
      </span>
    </div>
    <div className="flex items-center gap-3">
      <div className="flex-1">
        <Slider
          min={SYNC_OFFSET.min}
          max={SYNC_OFFSET.max}
          step={SYNC_OFFSET.step}
          value={offsetMs}
          onChange={onChange}
        />
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={onReset}
        disabled={offsetMs === 0}
        className="flex-shrink-0 h-8 px-2 text-xs"
      >
        Reset
      </Button>
    </div>
    <p className="text-xs text-muted-foreground">
      {offsetMs > 0
        ? 'Áudio começa mais tarde no vídeo.'
        : offsetMs < 0
          ? 'Áudio começa mais cedo no vídeo.'
          : 'Sem deslocamento de tempo.'}
    </p>
  </div>
)

const DisabledPanelPlaceholder = ({
  icon,
  title,
  message,
}: {
  icon: React.ReactNode
  title: string
  message: string
}) => (
  <div className="flex flex-col items-center justify-center h-full text-center p-8 bg-muted/30">
    <div className="w-16 h-16 rounded-full bg-background/60 flex items-center justify-center mb-4 border border-border">
      {icon}
    </div>
    <h3 className="font-semibold text-foreground">{title}</h3>
    <p className="text-sm text-muted-foreground mt-1 max-w-xs">{message}</p>
  </div>
)

export function AudioSettings() {
  const {
    volume,
    isMuted,
    setVolume,
    toggleMute,
    hasAudioTrack,
    setIsMuted,
    audioUrl,
    systemAudioUrl,
    systemAudioVolume,
    systemAudioMuted,
    updateSystemAudioSettings,
    recordingSyncOffsetMs,
    systemAudioSyncOffsetMs,
    setRecordingSyncOffsetMs,
    setSystemAudioSyncOffsetMs,
  } = useEditorStore(
    useShallow((state) => ({
      volume: state.volume,
      isMuted: state.isMuted,
      setVolume: state.setVolume,
      toggleMute: state.toggleMute,
      hasAudioTrack: state.hasAudioTrack,
      setIsMuted: state.setIsMuted,
      audioUrl: state.audioUrl,
      systemAudioUrl: state.systemAudioUrl,
      systemAudioVolume: state.systemAudioVolume,
      systemAudioMuted: state.systemAudioMuted,
      updateSystemAudioSettings: state.updateSystemAudioSettings,
      recordingSyncOffsetMs: state.recordingSyncOffsetMs,
      systemAudioSyncOffsetMs: state.systemAudioSyncOffsetMs,
      setRecordingSyncOffsetMs: state.setRecordingSyncOffsetMs,
      setSystemAudioSyncOffsetMs: state.setSystemAudioSyncOffsetMs,
    })),
  )

  const VolumeIcon = isMuted || volume === 0 ? MuteVolume : volume < 0.5 ? MinVolume : MaxVolume
  const SystemAudioIcon =
    systemAudioMuted || systemAudioVolume === 0 ? MuteVolume : systemAudioVolume < 0.5 ? MinVolume : MaxVolume

  const handleResetVolume = () => {
    setVolume(DEFAULTS.AUDIO.VOLUME.defaultValue)
    setIsMuted(DEFAULTS.AUDIO.MUTED.defaultValue)
  }

  const handleResetSystemAudio = () => {
    updateSystemAudioSettings({ volume: 1, isMuted: false })
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-6 border-b border-sidebar-border flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Microphone className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-sidebar-foreground">Audio Settings</h2>
            <p className="text-sm text-muted-foreground">Adjust volume and effects</p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto stable-scrollbar">
        {!hasAudioTrack ? (
          <DisabledPanelPlaceholder
            icon={<MicrophoneOff className="w-8 h-8 text-muted-foreground" />}
            title="No Audio Detected"
            message="These settings are unavailable because the current video does not contain an audio track."
          />
        ) : (
          <div className="p-6 space-y-6">
            {audioUrl && (
              <Collapse
                title="Microphone"
                description="Control captured microphone audio separately"
                icon={<Microphone className="w-4 h-4 text-primary" />}
                defaultOpen={true}
                onReset={handleResetVolume}
              >
                <div className="space-y-4 pt-2">
                  <div className="flex items-center gap-3">
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={toggleMute}
                      className="flex-shrink-0 h-10 w-10 text-foreground dark:text-white"
                      aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
                    >
                      <VolumeIcon className="w-5 h-5" />
                    </Button>
                    <div className="flex-1">
                      <Slider
                        min={DEFAULTS.AUDIO.VOLUME.min}
                        max={DEFAULTS.AUDIO.VOLUME.max}
                        step={DEFAULTS.AUDIO.VOLUME.step}
                        value={isMuted ? 0 : volume}
                        onChange={(value) => setVolume(value)}
                        disabled={isMuted}
                      />
                    </div>
                    <span className="text-xs font-semibold text-primary tabular-nums w-10 text-right">
                      {Math.round((isMuted ? 0 : volume) * 100)}%
                    </span>
                  </div>
                  <Button
                    onClick={() => setVolume(1)}
                    disabled={isMuted}
                    className={cn(
                      'w-full h-11 font-semibold transition-all duration-300',
                      'bg-primary hover:bg-primary/90 text-primary-foreground',
                    )}
                  >
                    <MaxVolume className="w-4 h-4 mr-2" />
                    Set to Max Volume
                  </Button>
                </div>
                <div className="pt-2 border-t border-border/60">
                  <SyncOffsetControl
                    label="Sync offset"
                    offsetMs={recordingSyncOffsetMs}
                    onChange={setRecordingSyncOffsetMs}
                    onReset={() => setRecordingSyncOffsetMs(0)}
                  />
                </div>
              </Collapse>
            )}

            {systemAudioUrl && (
              <Collapse
                title="Computer Audio"
                description="Control captured PC audio separately"
                icon={<Volume className="w-4 h-4 text-primary" />}
                defaultOpen={false}
                onReset={handleResetSystemAudio}
              >
                <div className="space-y-4 pt-2">
                  <div className="flex items-center gap-3">
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => updateSystemAudioSettings({ isMuted: !systemAudioMuted })}
                      className="flex-shrink-0 h-10 w-10 text-foreground dark:text-white"
                      aria-label={systemAudioMuted ? 'Unmute computer audio' : 'Mute computer audio'}
                    >
                      <SystemAudioIcon className="w-5 h-5" />
                    </Button>
                    <div className="flex-1">
                      <Slider
                        min={DEFAULTS.AUDIO.VOLUME.min}
                        max={DEFAULTS.AUDIO.VOLUME.max}
                        step={DEFAULTS.AUDIO.VOLUME.step}
                        value={systemAudioMuted ? 0 : systemAudioVolume}
                        onChange={(value) => updateSystemAudioSettings({ volume: value, isMuted: false })}
                        disabled={systemAudioMuted}
                      />
                    </div>
                    <span className="text-xs font-semibold text-primary tabular-nums w-10 text-right">
                      {Math.round((systemAudioMuted ? 0 : systemAudioVolume) * 100)}%
                    </span>
                  </div>
                  <Button
                    onClick={() => updateSystemAudioSettings({ volume: 1, isMuted: false })}
                    disabled={systemAudioMuted}
                    className={cn(
                      'w-full h-11 font-semibold transition-all duration-300',
                      'bg-primary hover:bg-primary/90 text-primary-foreground',
                    )}
                  >
                    <MaxVolume className="w-4 h-4 mr-2" />
                    Set to Max Volume
                  </Button>
                </div>
                <div className="pt-2 border-t border-border/60">
                  <SyncOffsetControl
                    label="Sync offset"
                    offsetMs={systemAudioSyncOffsetMs}
                    onChange={setSystemAudioSyncOffsetMs}
                    onReset={() => setSystemAudioSyncOffsetMs(0)}
                  />
                </div>
              </Collapse>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
