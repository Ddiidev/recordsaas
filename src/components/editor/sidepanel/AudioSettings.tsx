import { useEditorStore } from '../../../store/editorStore'
import { useShallow } from 'zustand/react/shallow'
import {
  Microphone,
  Volume,
  Volume2 as MinVolume,
  Volume as MaxVolume,
  Volume3 as MuteVolume,
  MicrophoneOff,
} from 'tabler-icons-react'
import { Collapse } from '../../ui/collapse'
import { Slider } from '../../ui/slider'
import { Button } from '../../ui/button'
import { DEFAULTS } from '../../../lib/constants'

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

function VolumeControl({
  label,
  description,
  value,
  muted,
  onToggleMute,
  onChangeVolume,
  onReset,
  disabled,
}: {
  label: string
  description: string
  value: number
  muted: boolean
  onToggleMute: () => void
  onChangeVolume: (value: number) => void
  onReset: () => void
  disabled?: boolean
}) {
  const VolumeIcon = muted || value === 0 ? MuteVolume : value < 0.5 ? MinVolume : MaxVolume

  return (
    <Collapse title={label} description={description} icon={<Volume className="w-4 h-4 text-primary" />} defaultOpen={true} onReset={onReset}>
      <div className="space-y-4 pt-2">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="icon"
            onClick={onToggleMute}
            className="flex-shrink-0 h-10 w-10 text-foreground dark:text-white"
            aria-label={muted ? 'Unmute' : 'Mute'}
            disabled={disabled}
          >
            <VolumeIcon className="w-5 h-5" />
          </Button>
          <div className="flex-1">
            <Slider
              min={DEFAULTS.AUDIO.VOLUME.min}
              max={DEFAULTS.AUDIO.VOLUME.max}
              step={DEFAULTS.AUDIO.VOLUME.step}
              value={muted ? 0 : value}
              onChange={(nextValue) => onChangeVolume(nextValue)}
              disabled={disabled || muted}
            />
          </div>
          <span className="text-xs font-semibold text-primary tabular-nums w-10 text-right">
            {Math.round((muted ? 0 : value) * 100)}%
          </span>
        </div>
      </div>
    </Collapse>
  )
}

export function AudioSettings() {
  const {
    hasAnyAudioTrack,
    hasMicAudioTrack,
    masterVolume,
    masterMuted,
    micVolume,
    micMuted,
    setMasterVolume,
    toggleMasterMute,
    setMasterMuted,
    setMicVolume,
    toggleMicMute,
    setMicMuted,
  } = useEditorStore(
    useShallow((state) => ({
      hasAnyAudioTrack: state.hasAnyAudioTrack,
      hasMicAudioTrack: state.hasMicAudioTrack,
      masterVolume: state.masterVolume,
      masterMuted: state.masterMuted,
      micVolume: state.micVolume,
      micMuted: state.micMuted,
      setMasterVolume: state.setMasterVolume,
      toggleMasterMute: state.toggleMasterMute,
      setMasterMuted: state.setMasterMuted,
      setMicVolume: state.setMicVolume,
      toggleMicMute: state.toggleMicMute,
      setMicMuted: state.setMicMuted,
    })),
  )

  return (
    <div className="h-full flex flex-col">
      <div className="p-6 border-b border-sidebar-border flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Microphone className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-sidebar-foreground">Audio Settings</h2>
            <p className="text-sm text-muted-foreground">Master and per-track controls</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto stable-scrollbar">
        {!hasAnyAudioTrack ? (
          <DisabledPanelPlaceholder
            icon={<MicrophoneOff className="w-8 h-8 text-muted-foreground" />}
            title="No Audio Detected"
            message="These settings are unavailable because the current project does not contain audio tracks."
          />
        ) : (
          <div className="p-6 space-y-6">
            <VolumeControl
              label="Master Volume"
              description="Controls overall project loudness"
              value={masterVolume}
              muted={masterMuted}
              onToggleMute={toggleMasterMute}
              onChangeVolume={setMasterVolume}
              onReset={() => {
                setMasterVolume(DEFAULTS.AUDIO.MASTER_VOLUME.defaultValue)
                setMasterMuted(DEFAULTS.AUDIO.MASTER_MUTED.defaultValue)
              }}
            />

            <VolumeControl
              label="Microphone Track"
              description="Controls microphone audio track"
              value={micVolume}
              muted={micMuted}
              onToggleMute={toggleMicMute}
              onChangeVolume={setMicVolume}
              onReset={() => {
                setMicVolume(DEFAULTS.AUDIO.MIC_VOLUME.defaultValue)
                setMicMuted(DEFAULTS.AUDIO.MIC_MUTED.defaultValue)
              }}
              disabled={!hasMicAudioTrack}
            />
            {!hasMicAudioTrack && (
              <p className="text-xs text-muted-foreground pl-1">No microphone track available in this project.</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
