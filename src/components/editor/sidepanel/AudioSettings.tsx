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
import { cn } from '../../../lib/utils'
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

export function AudioSettings() {
  const { volume, isMuted, setVolume, toggleMute, hasAudioTrack, setIsMuted } = useEditorStore(
    useShallow((state) => ({
      volume: state.volume,
      isMuted: state.isMuted,
      setVolume: state.setVolume,
      toggleMute: state.toggleMute,
      hasAudioTrack: state.hasAudioTrack,
      setIsMuted: state.setIsMuted,
    })),
  )

  const VolumeIcon = isMuted || volume === 0 ? MuteVolume : volume < 0.5 ? MinVolume : MaxVolume

  const handleResetVolume = () => {
    setVolume(DEFAULTS.AUDIO.VOLUME.defaultValue)
    setIsMuted(DEFAULTS.AUDIO.MUTED.defaultValue)
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
            <Collapse
              title="Master Volume"
              description="Control the overall volume of the video"
              icon={<Volume className="w-4 h-4 text-primary" />}
              defaultOpen={true}
              onReset={handleResetVolume}
            >
              <div className="space-y-4 pt-2">
                <div className="flex items-center gap-3">
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={toggleMute}
                    className="flex-shrink-0 h-10 w-10"
                    aria-label={isMuted ? 'Unmute' : 'Mute'}
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
            </Collapse>
          </div>
        )}
      </div>
    </div>
  )
}
