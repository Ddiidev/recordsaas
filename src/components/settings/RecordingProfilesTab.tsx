import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button } from '../ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Input } from '../ui/input'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip'
import { InfoCircle, Loader2, Plus, Trash } from '@icons'
import { cn } from '../../lib/utils'
import {
  AUDIO_BITRATE_OPTIONS,
  AUDIO_CODEC_LABELS,
  AUDIO_CODEC_OPTIONS,
  AUDIO_SAMPLE_RATE_OPTIONS,
  NATIVE_RECORDING_ANALYSIS_SETTING_KEY,
  NATIVE_RECORDING_PROFILE_ID,
  RECORDING_PROFILES_SETTING_KEY,
  RESOLUTION_LABELS,
  RESOLUTION_OPTIONS,
  SCREEN_FPS_OPTIONS,
  SELECTED_RECORDING_PROFILE_SETTING_KEY,
  WEBCAM_FPS_OPTIONS,
  createNativeRecordingProfile,
  isRecordingCapabilityAnalysis,
  normalizeRecordingProfiles,
  type RecordingCapabilityAnalysis,
  type RecordingProfile,
  type RecordingResolution,
  type RecordingScreenFps,
} from '../../lib/recording-profiles'

const createCustomProfile = (): RecordingProfile => ({
  id: `recording-profile-${Date.now()}`,
  name: 'Custom Profile',
  screenResolution: 'native',
  screenFps: 60,
  webcamResolution: 'native',
  webcamFps: 'synced',
  audioCodec: 'aac',
  audioBitrateKbps: 192,
  audioSampleRate: 48000,
})

const ANALYSIS_DURATION_SECONDS = 5

const persistProfiles = (profiles: RecordingProfile[]) => {
  window.electronAPI.setSetting(RECORDING_PROFILES_SETTING_KEY, profiles)
}

export function RecordingProfilesTab({
  createProfileRequestId = 0,
  analyzeRequestId = 0,
  onCreateProfileRequestHandled,
  onAnalyzeRequestHandled,
}: {
  createProfileRequestId?: number
  analyzeRequestId?: number
  onCreateProfileRequestHandled?: () => void
  onAnalyzeRequestHandled?: () => void
}) {
  const [profiles, setProfiles] = useState<RecordingProfile[]>([createNativeRecordingProfile()])
  const [selectedProfileId, setSelectedProfileId] = useState(NATIVE_RECORDING_PROFILE_ID)
  const [isEditing, setIsEditing] = useState(false)
  const [analysis, setAnalysis] = useState<RecordingCapabilityAnalysis | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analysisCountdown, setAnalysisCountdown] = useState(ANALYSIS_DURATION_SECONDS)
  const [isLoaded, setIsLoaded] = useState(false)
  const handledCreateRequestIdRef = useRef(0)
  const handledAnalyzeRequestIdRef = useRef(0)

  useEffect(() => {
    let isMounted = true

    const load = async () => {
      const [storedProfiles, storedSelectedId, storedAnalysis] = await Promise.all([
        window.electronAPI.getSetting<RecordingProfile[]>(RECORDING_PROFILES_SETTING_KEY),
        window.electronAPI.getSetting<string>(SELECTED_RECORDING_PROFILE_SETTING_KEY),
        window.electronAPI.getSetting<RecordingCapabilityAnalysis>(NATIVE_RECORDING_ANALYSIS_SETTING_KEY),
      ])
      if (!isMounted) return

      const validAnalysis = isRecordingCapabilityAnalysis(storedAnalysis) ? storedAnalysis : null
      const recommendedFps = validAnalysis?.recommendedFps === 60 ? 60 : 30
      const normalized = normalizeRecordingProfiles(storedProfiles, recommendedFps)
      setProfiles(normalized)
      setSelectedProfileId(
        normalized.some((profile) => profile.id === storedSelectedId) ? storedSelectedId : NATIVE_RECORDING_PROFILE_ID,
      )
      setAnalysis(validAnalysis)
      setIsLoaded(true)
    }

    void load()
    return () => {
      isMounted = false
    }
  }, [])

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId) ?? profiles[0] ?? createNativeRecordingProfile(),
    [profiles, selectedProfileId],
  )
  const isNativeProfile = selectedProfile.id === NATIVE_RECORDING_PROFILE_ID || selectedProfile.isNative
  const isAudioSettingsEditable = isNativeProfile || isEditing

  useEffect(() => {
    if (!isAnalyzing) {
      setAnalysisCountdown(ANALYSIS_DURATION_SECONDS)
      return
    }

    const startedAt = Date.now()
    const updateCountdown = () => {
      const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000)
      setAnalysisCountdown(Math.max(0, ANALYSIS_DURATION_SECONDS - elapsedSeconds))
    }
    updateCountdown()
    const interval = window.setInterval(updateCountdown, 250)

    return () => {
      window.clearInterval(interval)
    }
  }, [isAnalyzing])

  const updateProfiles = useCallback((updater: (current: RecordingProfile[]) => RecordingProfile[]) => {
    setProfiles((current) => {
      const next = updater(current)
      persistProfiles(next)
      return next
    })
  }, [])

  const updateSelectedProfile = useCallback(
    (patch: Partial<RecordingProfile>) => {
      updateProfiles((current) =>
        current.map((profile) => (profile.id === selectedProfile.id ? { ...profile, ...patch } : profile)),
      )
    },
    [selectedProfile.id, updateProfiles],
  )

  const handleAddProfile = useCallback(() => {
    const profile = createCustomProfile()
    updateProfiles((current) => [...current, profile])
    setSelectedProfileId(profile.id)
    setIsEditing(true)
  }, [updateProfiles])

  useEffect(() => {
    if (!isLoaded || createProfileRequestId <= 0 || handledCreateRequestIdRef.current === createProfileRequestId) return

    handledCreateRequestIdRef.current = createProfileRequestId
    handleAddProfile()
    onCreateProfileRequestHandled?.()
  }, [createProfileRequestId, handleAddProfile, isLoaded, onCreateProfileRequestHandled])

  const handleDeleteProfile = () => {
    if (isNativeProfile) return
    updateProfiles((current) => current.filter((profile) => profile.id !== selectedProfile.id))
    setSelectedProfileId(NATIVE_RECORDING_PROFILE_ID)
    window.electronAPI.setSetting(SELECTED_RECORDING_PROFILE_SETTING_KEY, NATIVE_RECORDING_PROFILE_ID)
    setIsEditing(false)
  }

  const handleAnalyze = useCallback(async () => {
    setIsAnalyzing(true)
    setAnalysisCountdown(ANALYSIS_DURATION_SECONDS)
    try {
      const result = await window.electronAPI.analyzeRecordingCapability()
      setAnalysis(result)
      window.electronAPI.setSetting(NATIVE_RECORDING_ANALYSIS_SETTING_KEY, result)
      setProfiles((current) => {
        const currentNativeProfile = current.find((profile) => profile.id === NATIVE_RECORDING_PROFILE_ID)
        const next = current.map((profile) =>
          profile.id === NATIVE_RECORDING_PROFILE_ID
            ? createNativeRecordingProfile(result.recommendedFps, currentNativeProfile)
            : profile,
        )
        persistProfiles(next)
        return next
      })
    } catch (error) {
      console.error('Failed to analyze recording capability:', error)
    } finally {
      setIsAnalyzing(false)
    }
  }, [])

  useEffect(() => {
    if (!isLoaded || analyzeRequestId <= 0 || handledAnalyzeRequestIdRef.current === analyzeRequestId) return
    if (analysis || isAnalyzing) return

    handledAnalyzeRequestIdRef.current = analyzeRequestId
    void handleAnalyze().finally(() => {
      onAnalyzeRequestHandled?.()
    })
  }, [analysis, analyzeRequestId, handleAnalyze, isAnalyzing, isLoaded, onAnalyzeRequestHandled])

  const handleSelectedProfileChange = (id: string) => {
    setSelectedProfileId(id)
    window.electronAPI.setSetting(SELECTED_RECORDING_PROFILE_SETTING_KEY, id)
    setIsEditing(false)
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className="p-8">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Recording Profiles</h2>
            <p className="text-sm text-muted-foreground">
              Control capture resolution, FPS, and audio compression before recording starts.
            </p>
          </div>
          <Button onClick={handleAddProfile} size="sm">
            <Plus className="mr-2 h-4 w-4" />
            New
          </Button>
        </div>

        <div className="grid grid-cols-[20rem_1fr] gap-6">
          <div className="space-y-2">
            {profiles.map((profile) => (
              <button
                key={profile.id}
                onClick={() => handleSelectedProfileChange(profile.id)}
                className={cn(
                  'w-full rounded-lg border px-3 py-3 text-left transition-colors',
                  selectedProfileId === profile.id
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-border bg-muted/30 text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                )}
              >
                <span className="block text-sm font-semibold">{profile.name}</span>
                <span className="mt-1 block text-xs">
                  {profile.isNative
                    ? `Screen native, ${profile.screenFps}fps / webcam native, 30fps`
                    : `${RESOLUTION_LABELS[profile.screenResolution]}, ${profile.screenFps}fps`}
                </span>
              </button>
            ))}
          </div>

          <div className="space-y-4">
            {isNativeProfile && (
              <div className="rounded-lg border border-primary/30 bg-primary/10 p-5">
                <h3 className="text-sm font-semibold text-foreground">Native Adaptive profile</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Uses the selected screen's native resolution. Screen FPS is selected by the performance analysis tool,
                  targeting 60fps when the PC can sustain it and falling back to 30fps when needed. Webcam stays at
                  30fps and requests the same capture resolution as the selected screen or area. Audio compression can
                  still be customized below.
                </p>
              </div>
            )}

            <div className="flex items-center justify-between gap-5 rounded-lg border border-border bg-muted/30 p-5">
              <div>
                <h3 className="text-sm font-semibold text-foreground">60fps Analysis</h3>
                <p className="text-sm text-muted-foreground">
                  {analysis
                    ? `${analysis.reason}${typeof analysis.measuredFps === 'number' ? ` Measured: ${analysis.measuredFps.toFixed(1)}fps.` : ''}`
                    : 'Run a 5-second capture probe to decide whether native recording should use 60fps or 30fps.'}
                </p>
              </div>
              <Button onClick={handleAnalyze} disabled={isAnalyzing} variant="secondary" size="sm">
                {isAnalyzing ? (
                  <span className="mr-2 grid h-5 w-5 place-items-center">
                    <Loader2 className="col-start-1 row-start-1 h-5 w-5 animate-spin" />
                    <span className="col-start-1 row-start-1 text-[10px] font-semibold leading-none">
                      {analysisCountdown}
                    </span>
                  </span>
                ) : null}
                {isAnalyzing ? 'Analyzing' : 'Analyze'}
              </Button>
            </div>

            <div className="rounded-lg border border-border bg-muted/30 p-4">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">{selectedProfile.name}</h3>
                  <p className="text-sm text-muted-foreground">
                    {isNativeProfile
                      ? 'Video settings are managed by analysis. Audio settings below remain editable.'
                      : 'Edit the selected recording profile.'}
                  </p>
                </div>
                <div className="flex gap-2">
                  {!isNativeProfile && (
                    <>
                      <Button variant="secondary" size="sm" onClick={() => setIsEditing((value) => !value)}>
                        {isEditing ? 'Done' : 'Edit'}
                      </Button>
                      <Button variant="destructive" size="sm" onClick={handleDeleteProfile}>
                        <Trash className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                </div>
              </div>

              <div className="space-y-3">
                {!isNativeProfile && isEditing && (
                  <Field label="Name">
                    <Input
                      value={selectedProfile.name}
                      onChange={(event) => updateSelectedProfile({ name: event.target.value })}
                      className="h-10 bg-background/50"
                    />
                  </Field>
                )}

                <Field label="Screen resolution">
                  <Select
                    value={selectedProfile.screenResolution}
                    onValueChange={(value) => updateSelectedProfile({ screenResolution: value as RecordingResolution })}
                    disabled={!isEditing || isNativeProfile}
                  >
                    <SelectTrigger className="h-10 bg-background/50">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RESOLUTION_OPTIONS.map((option) => (
                        <SelectItem key={option} value={option}>
                          {RESOLUTION_LABELS[option]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                <Field label="Screen FPS">
                  <Select
                    value={String(selectedProfile.screenFps)}
                    onValueChange={(value) => updateSelectedProfile({ screenFps: Number(value) as RecordingScreenFps })}
                    disabled={!isEditing || isNativeProfile}
                  >
                    <SelectTrigger className="h-10 bg-background/50">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SCREEN_FPS_OPTIONS.map((fps) => (
                        <SelectItem key={fps} value={String(fps)}>
                          {fps}fps
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                {isNativeProfile && (
                  <div className="grid grid-cols-[10rem_1fr] items-start gap-3">
                    <div />
                    <p className="text-xs leading-5 text-muted-foreground">
                      Este perfil padrão é definido pela análise. Para ajustar FPS, resolução e webcam manualmente, crie
                      um perfil customizado.
                    </p>
                  </div>
                )}

                <Field label="Webcam resolution">
                  <Select
                    value={selectedProfile.webcamResolution}
                    onValueChange={(value) => updateSelectedProfile({ webcamResolution: value as RecordingResolution })}
                    disabled={!isEditing || isNativeProfile}
                  >
                    <SelectTrigger className="h-10 bg-background/50">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RESOLUTION_OPTIONS.map((option) => (
                        <SelectItem key={option} value={option}>
                          {RESOLUTION_LABELS[option]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                <Field
                  label={
                    <span className="inline-flex items-center gap-1">
                      Webcam FPS
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex h-5 w-5 items-center justify-center text-muted-foreground">
                            <InfoCircle className="h-4 w-4" />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          Synchronized follows the screen FPS but caps webcam capture at 60fps.
                        </TooltipContent>
                      </Tooltip>
                    </span>
                  }
                >
                  <Select
                    value={String(selectedProfile.webcamFps)}
                    onValueChange={(value) =>
                      updateSelectedProfile({ webcamFps: value === 'synced' ? 'synced' : (Number(value) as 30 | 60) })
                    }
                    disabled={!isEditing || isNativeProfile}
                  >
                    <SelectTrigger className="h-10 bg-background/50">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {WEBCAM_FPS_OPTIONS.map((fps) => (
                        <SelectItem key={fps} value={String(fps)}>
                          {fps === 'synced' ? 'Synchronized' : `${fps}fps`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                <div className="my-2 border-t border-border/70 pt-4">
                  <div className="mb-3">
                    <h4 className="text-sm font-semibold text-foreground">Audio</h4>
                    <p className="text-sm text-muted-foreground">
                      Controls recorded microphone audio and computer audio compression.
                    </p>
                  </div>
                </div>

                <Field
                  label={
                    <span className="inline-flex items-center gap-1">
                      Format
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex h-5 w-5 items-center justify-center text-muted-foreground">
                            <InfoCircle className="h-4 w-4" />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          AAC usually gives better quality per MB. MP3 is useful for compatibility.
                        </TooltipContent>
                      </Tooltip>
                    </span>
                  }
                >
                  <Select
                    value={selectedProfile.audioCodec}
                    onValueChange={(value) =>
                      updateSelectedProfile({ audioCodec: value as RecordingProfile['audioCodec'] })
                    }
                    disabled={!isAudioSettingsEditable}
                  >
                    <SelectTrigger className="h-10 bg-background/50">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {AUDIO_CODEC_OPTIONS.map((codec) => (
                        <SelectItem key={codec} value={codec}>
                          {AUDIO_CODEC_LABELS[codec]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                <Field label="Bitrate">
                  <Select
                    value={String(selectedProfile.audioBitrateKbps)}
                    onValueChange={(value) =>
                      updateSelectedProfile({ audioBitrateKbps: Number(value) as RecordingProfile['audioBitrateKbps'] })
                    }
                    disabled={!isAudioSettingsEditable}
                  >
                    <SelectTrigger className="h-10 bg-background/50">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {AUDIO_BITRATE_OPTIONS.map((bitrate) => (
                        <SelectItem key={bitrate} value={String(bitrate)}>
                          {bitrate} kbps
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                <Field
                  label={
                    <span className="inline-flex items-center gap-1">
                      Sample rate
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex h-5 w-5 items-center justify-center text-muted-foreground">
                            <InfoCircle className="h-4 w-4" />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          48 kHz is recommended for screen recordings and video workflows.
                        </TooltipContent>
                      </Tooltip>
                    </span>
                  }
                >
                  <Select
                    value={String(selectedProfile.audioSampleRate)}
                    onValueChange={(value) =>
                      updateSelectedProfile({ audioSampleRate: Number(value) as RecordingProfile['audioSampleRate'] })
                    }
                    disabled={!isAudioSettingsEditable}
                  >
                    <SelectTrigger className="h-10 bg-background/50">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {AUDIO_SAMPLE_RATE_OPTIONS.map((sampleRate) => (
                        <SelectItem key={sampleRate} value={String(sampleRate)}>
                          {sampleRate === 48000 ? '48 kHz' : '44.1 kHz'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            </div>
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}

const Field = ({ label, children }: { label: ReactNode; children: ReactNode }) => (
  <div className="grid grid-cols-[10rem_1fr] items-center gap-3">
    <div className="text-sm font-medium text-foreground/90">{label}</div>
    <div>{children}</div>
  </div>
)
