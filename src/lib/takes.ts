import type {
  MetaDataItem,
  TakeAudioMode,
  TakeClip,
  TakeSourceRef,
  TakeTransition,
  TakeTransitionType,
  ZoomRegion,
} from '../types'

export const TAKE_MIN_DURATION = 0.1
export const TAKE_TRANSITION_MIN_DURATION = 0.1
export const TAKE_TRANSITION_MAX_DURATION = 2
export const TAKE_TRANSITION_DEFAULT_DURATION = 0.3

const TRANSITION_TYPES = new Set<TakeTransitionType>(['dissolve', 'dip-black', 'slide-left', 'slide-right', 'zoom'])

const AUDIO_MODES = new Set<TakeAudioMode>(['session', 'source', 'none'])

const finite = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

const isSource = (value: unknown): value is TakeSourceRef => {
  if (!value || typeof value !== 'object') return false
  const source = value as Partial<TakeSourceRef>
  if (source.kind === 'recording-screen' || source.kind === 'recording-webcam') return true
  return source.kind === 'imported-video' && typeof source.assetId === 'string' && source.assetId.length > 0
}

export const getTakeSourceDuration = (
  source: TakeSourceRef,
  sourceDuration: number,
  importedDurations: Record<string, number> = {},
): number => {
  if (source.kind === 'imported-video') return Math.max(0, finite(importedDurations[source.assetId]))
  return Math.max(0, finite(sourceDuration))
}

export const createScreenTake = (id: string, sourceStart: number, duration: number, name?: string): TakeClip => ({
  id,
  name,
  source: { kind: 'recording-screen' },
  sourceStart: Math.max(0, sourceStart),
  duration: Math.max(TAKE_MIN_DURATION, duration),
  audioMode: 'session',
  sessionAudioStart: Math.max(0, sourceStart),
  volume: 1,
  isMuted: false,
})

export const createTakesFromBoundaries = (
  sourceDuration: number,
  boundaries: number[],
  createId: (index: number) => string,
  minDuration = TAKE_MIN_DURATION,
): TakeClip[] => {
  const physicalDuration = Math.max(0, finite(sourceDuration))
  if (physicalDuration <= 0) return []
  const minimum = Math.max(TAKE_MIN_DURATION, finite(minDuration, TAKE_MIN_DURATION))
  const points = [0, ...boundaries, physicalDuration]
    .map((value) => clamp(finite(value), 0, physicalDuration))
    .sort((left, right) => left - right)
    .filter((value, index, values) => index === 0 || value - values[index - 1] >= minimum)

  if (physicalDuration - points[points.length - 1] < minimum) points[points.length - 1] = physicalDuration
  if (points[points.length - 1] !== physicalDuration) points.push(physicalDuration)

  return points
    .slice(0, -1)
    .map((start, index) => createScreenTake(createId(index), start, points[index + 1] - start, `Take ${index + 1}`))
}

export interface NormalizeTakesOptions {
  sourceDuration: number
  importedDurations?: Record<string, number>
  createId?: (index: number) => string
}

export const normalizeTakes = (value: unknown, options: NormalizeTakesOptions): TakeClip[] => {
  if (!Array.isArray(value)) return []
  const createId = options.createId || ((index: number) => `take-${index + 1}`)
  const seen = new Set<string>()

  return value.reduce<TakeClip[]>((takes, raw, index) => {
    if (!raw || typeof raw !== 'object') return takes
    const candidate = raw as Partial<TakeClip>
    if (!isSource(candidate.source)) return takes
    const sourceLimit = getTakeSourceDuration(candidate.source, options.sourceDuration, options.importedDurations)
    if (sourceLimit <= 0) return takes
    const sourceStart = clamp(finite(candidate.sourceStart), 0, Math.max(0, sourceLimit - TAKE_MIN_DURATION))
    const duration = clamp(finite(candidate.duration, TAKE_MIN_DURATION), TAKE_MIN_DURATION, sourceLimit - sourceStart)
    if (duration < TAKE_MIN_DURATION) return takes
    let id = typeof candidate.id === 'string' && candidate.id.trim() ? candidate.id.trim() : createId(index)
    while (seen.has(id)) id = createId(index + seen.size + 1)
    seen.add(id)
    const audioMode = AUDIO_MODES.has(candidate.audioMode as TakeAudioMode)
      ? (candidate.audioMode as TakeAudioMode)
      : candidate.source.kind === 'imported-video'
        ? 'source'
        : 'session'
    const sessionAudioStart =
      audioMode === 'session'
        ? Math.max(0, finite(candidate.sessionAudioStart, candidate.source.kind === 'imported-video' ? 0 : sourceStart))
        : undefined

    takes.push({
      id,
      name:
        typeof candidate.name === 'string' && candidate.name.trim()
          ? candidate.name.trim()
          : `Take ${takes.length + 1}`,
      source: candidate.source,
      sourceStart,
      duration,
      audioMode,
      sessionAudioStart,
      volume: clamp(finite(candidate.volume, 1), 0, 1),
      isMuted: candidate.isMuted === true,
    })
    return takes
  }, [])
}

export const getTransitionDuration = (transition: TakeTransition | undefined, from: TakeClip, to: TakeClip): number => {
  if (!transition) return 0
  return clamp(
    finite(transition.duration, TAKE_TRANSITION_DEFAULT_DURATION),
    TAKE_TRANSITION_MIN_DURATION,
    Math.min(TAKE_TRANSITION_MAX_DURATION, from.duration / 2, to.duration / 2),
  )
}

export const normalizeTakeTransitions = (value: unknown, takes: TakeClip[]): TakeTransition[] => {
  if (!Array.isArray(value) || takes.length < 2) return []
  const adjacency = new Map<string, [TakeClip, TakeClip]>()
  for (let index = 0; index < takes.length - 1; index += 1) {
    adjacency.set(`${takes[index].id}\0${takes[index + 1].id}`, [takes[index], takes[index + 1]])
  }
  const seen = new Set<string>()
  return value.reduce<TakeTransition[]>((transitions, raw) => {
    if (!raw || typeof raw !== 'object') return transitions
    const transition = raw as Partial<TakeTransition>
    if (typeof transition.fromTakeId !== 'string' || typeof transition.toTakeId !== 'string') return transitions
    const key = `${transition.fromTakeId}\0${transition.toTakeId}`
    const pair = adjacency.get(key)
    if (!pair || seen.has(key) || !TRANSITION_TYPES.has(transition.type as TakeTransitionType)) return transitions
    seen.add(key)
    const normalized: TakeTransition = {
      fromTakeId: transition.fromTakeId,
      toTakeId: transition.toTakeId,
      type: transition.type as TakeTransitionType,
      duration: finite(transition.duration, TAKE_TRANSITION_DEFAULT_DURATION),
      audioMode: transition.audioMode === 'crossfade' ? 'crossfade' : 'cut',
    }
    normalized.duration = getTransitionDuration(normalized, pair[0], pair[1])
    transitions.push(normalized)
    return transitions
  }, [])
}

export interface PositionedTake {
  take: TakeClip
  start: number
  end: number
  transitionIn?: TakeTransition
  transitionInDuration: number
}

export const positionTakes = (takes: TakeClip[], transitions: TakeTransition[]): PositionedTake[] => {
  const byBoundary = new Map(
    transitions.map((transition) => [`${transition.fromTakeId}\0${transition.toTakeId}`, transition]),
  )
  let cursor = 0
  return takes.map((take, index) => {
    const previous = takes[index - 1]
    const transitionIn = previous ? byBoundary.get(`${previous.id}\0${take.id}`) : undefined
    const transitionInDuration = previous ? getTransitionDuration(transitionIn, previous, take) : 0
    cursor -= transitionInDuration
    const positioned = { take, start: cursor, end: cursor + take.duration, transitionIn, transitionInDuration }
    cursor = positioned.end
    return positioned
  })
}

export const isAutoGeneratedZoomRegion = (region: ZoomRegion): boolean => region.id.startsWith('auto-zoom-')

export const remapAutoZoomRegionsForTakes = (
  sourceRegions: ZoomRegion[],
  takes: TakeClip[],
  transitions: TakeTransition[],
): Record<string, ZoomRegion> => {
  const remapped: Record<string, ZoomRegion> = {}
  const automaticRegions = sourceRegions.filter(isAutoGeneratedZoomRegion)

  positionTakes(takes, transitions).forEach(({ take, start: compositionStart }) => {
    if (take.source.kind !== 'recording-screen') return
    const takeSourceEnd = take.sourceStart + take.duration
    automaticRegions.forEach((region) => {
      const clippedStart = Math.max(region.startTime, take.sourceStart)
      const clippedEnd = Math.min(region.startTime + region.duration, takeSourceEnd)
      const duration = clippedEnd - clippedStart
      if (duration < TAKE_MIN_DURATION) return

      const id = `${region.id}:take:${take.id}`
      remapped[id] = {
        ...region,
        id,
        startTime: compositionStart + clippedStart - take.sourceStart,
        duration,
        transitionDuration: Math.min(region.transitionDuration, duration / 2),
        generatedTakeId: take.id,
        generatedEffectStartTime: compositionStart + region.startTime - take.sourceStart,
        generatedEffectDuration: region.duration,
        generatedEffectTransitionDuration: region.transitionDuration,
      }
    })
  })

  return remapped
}

export const mapTakeMetadataToComposition = (
  metadata: MetaDataItem[],
  take: TakeClip,
  compositionStart: number,
): MetaDataItem[] => {
  if (take.source.kind !== 'recording-screen') return []
  const sourceEnd = take.sourceStart + take.duration
  return metadata
    .filter((event) => event.timestamp < sourceEnd)
    .map((event) => ({ ...event, timestamp: compositionStart + event.timestamp - take.sourceStart }))
}

export const getTakeScopedZoomRegions = (
  regions: Record<string, ZoomRegion>,
  takeId: string,
): Record<string, ZoomRegion> =>
  Object.fromEntries(
    Object.entries(regions)
      .filter(([, region]) => !isAutoGeneratedZoomRegion(region) || region.generatedTakeId === takeId)
      .map(([id, region]) =>
        isAutoGeneratedZoomRegion(region) && region.generatedTakeId === takeId
          ? [
              id,
              {
                ...region,
                startTime: region.generatedEffectStartTime ?? region.startTime,
                duration: region.generatedEffectDuration ?? region.duration,
                transitionDuration: region.generatedEffectTransitionDuration ?? region.transitionDuration,
              },
            ]
          : [id, region],
      ),
  )

export const getTakeCompositionDuration = (takes: TakeClip[], transitions: TakeTransition[]): number =>
  (() => {
    const positioned = positionTakes(takes, transitions)
    return positioned[positioned.length - 1]?.end || 0
  })()

export interface TakeSourceTime {
  take: TakeClip
  sourceTime: number
  weight: number
}

export interface TakeTimeMapping {
  compositionTime: number
  primary: TakeSourceTime
  secondary?: TakeSourceTime
  transition?: TakeTransition
  transitionProgress: number
}

export const mapCompositionTimeToTake = (
  compositionTime: number,
  takes: TakeClip[],
  transitions: TakeTransition[],
): TakeTimeMapping | null => {
  const positioned = positionTakes(takes, transitions)
  if (positioned.length === 0) return null
  const duration = positioned[positioned.length - 1]?.end || 0
  const time = clamp(finite(compositionTime), 0, duration)
  const incomingIndex = positioned.findIndex(
    (item, index) =>
      index > 0 && item.transitionInDuration > 0 && time >= item.start && time < item.start + item.transitionInDuration,
  )
  if (incomingIndex >= 0) {
    const incoming = positioned[incomingIndex]
    const outgoing = positioned[incomingIndex - 1]
    const progress = clamp((time - incoming.start) / incoming.transitionInDuration, 0, 1)
    return {
      compositionTime: time,
      primary: {
        take: outgoing.take,
        sourceTime: outgoing.take.sourceStart + (time - outgoing.start),
        weight: 1 - progress,
      },
      secondary: {
        take: incoming.take,
        sourceTime: incoming.take.sourceStart + (time - incoming.start),
        weight: progress,
      },
      transition: incoming.transitionIn,
      transitionProgress: progress,
    }
  }
  const active =
    positioned.find((item, index) => time >= item.start && (time < item.end || index === positioned.length - 1)) ||
    positioned[positioned.length - 1]
  return {
    compositionTime: time,
    primary: {
      take: active.take,
      sourceTime: active.take.sourceStart + clamp(time - active.start, 0, active.take.duration),
      weight: 1,
    },
    transitionProgress: 0,
  }
}

const pruneTransitions = (takes: TakeClip[], transitions: TakeTransition[]): TakeTransition[] =>
  normalizeTakeTransitions(transitions, takes)

export const splitTake = (
  takes: TakeClip[],
  transitions: TakeTransition[],
  takeId: string,
  offset: number,
  newId: string,
): { takes: TakeClip[]; transitions: TakeTransition[] } => {
  const index = takes.findIndex((take) => take.id === takeId)
  if (index < 0) return { takes, transitions }
  const original = takes[index]
  const splitOffset = clamp(finite(offset), TAKE_MIN_DURATION, original.duration - TAKE_MIN_DURATION)
  if (splitOffset <= 0 || original.duration - splitOffset < TAKE_MIN_DURATION) return { takes, transitions }
  const left = { ...original, duration: splitOffset }
  const right: TakeClip = {
    ...original,
    id: newId,
    name: original.name ? `${original.name} B` : undefined,
    sourceStart: original.sourceStart + splitOffset,
    duration: original.duration - splitOffset,
    sessionAudioStart:
      typeof original.sessionAudioStart === 'number'
        ? original.sessionAudioStart + splitOffset
        : original.sessionAudioStart,
  }
  const nextTakes = [...takes.slice(0, index), left, right, ...takes.slice(index + 1)]
  return { takes: nextTakes, transitions: pruneTransitions(nextTakes, transitions) }
}

export const trimTake = (
  takes: TakeClip[],
  transitions: TakeTransition[],
  takeId: string,
  edge: 'start' | 'end',
  delta: number,
  sourceDuration: number,
  importedDurations: Record<string, number> = {},
): { takes: TakeClip[]; transitions: TakeTransition[] } => {
  const nextTakes = takes.map((take) => {
    if (take.id !== takeId) return take
    const limit = getTakeSourceDuration(take.source, sourceDuration, importedDurations)
    if (edge === 'start') {
      const applied = clamp(finite(delta), -take.sourceStart, take.duration - TAKE_MIN_DURATION)
      return {
        ...take,
        sourceStart: take.sourceStart + applied,
        duration: take.duration - applied,
        sessionAudioStart:
          typeof take.sessionAudioStart === 'number' ? Math.max(0, take.sessionAudioStart + applied) : undefined,
      }
    }
    const duration = clamp(
      take.duration + finite(delta),
      TAKE_MIN_DURATION,
      Math.max(TAKE_MIN_DURATION, limit - take.sourceStart),
    )
    return { ...take, duration }
  })
  return { takes: nextTakes, transitions: normalizeTakeTransitions(transitions, nextTakes) }
}

export const reorderTake = (
  takes: TakeClip[],
  transitions: TakeTransition[],
  takeId: string,
  direction: 'left' | 'right',
): { takes: TakeClip[]; transitions: TakeTransition[] } => {
  const from = takes.findIndex((take) => take.id === takeId)
  const to = direction === 'left' ? from - 1 : from + 1
  if (from < 0 || to < 0 || to >= takes.length) return { takes, transitions }
  const nextTakes = [...takes]
  ;[nextTakes[from], nextTakes[to]] = [nextTakes[to], nextTakes[from]]
  return { takes: nextTakes, transitions: pruneTransitions(nextTakes, transitions) }
}

export const duplicateTake = (
  takes: TakeClip[],
  transitions: TakeTransition[],
  takeId: string,
  newId: string,
): { takes: TakeClip[]; transitions: TakeTransition[] } => {
  const index = takes.findIndex((take) => take.id === takeId)
  if (index < 0) return { takes, transitions }
  const clone = {
    ...takes[index],
    source: { ...takes[index].source },
    id: newId,
    name: `${takes[index].name || `Take ${index + 1}`} Copy`,
  } as TakeClip
  const nextTakes = [...takes.slice(0, index + 1), clone, ...takes.slice(index + 1)]
  return { takes: nextTakes, transitions: pruneTransitions(nextTakes, transitions) }
}

export const deleteTake = (
  takes: TakeClip[],
  transitions: TakeTransition[],
  takeId: string,
): { takes: TakeClip[]; transitions: TakeTransition[] } => {
  if (takes.length <= 1) return { takes, transitions }
  const nextTakes = takes.filter((take) => take.id !== takeId)
  if (nextTakes.length === takes.length) return { takes, transitions }
  return { takes: nextTakes, transitions: pruneTransitions(nextTakes, transitions) }
}

export const replaceTake = (
  takes: TakeClip[],
  takeId: string,
  source: TakeSourceRef,
  sourceDuration: number,
  audioMode?: TakeAudioMode,
): TakeClip[] =>
  takes.map((take) =>
    take.id !== takeId
      ? take
      : {
          ...take,
          source,
          sourceStart: 0,
          duration: Math.max(TAKE_MIN_DURATION, Math.min(take.duration, sourceDuration)),
          audioMode: audioMode || (source.kind === 'imported-video' ? 'source' : 'session'),
          sessionAudioStart: audioMode === 'session' ? 0 : undefined,
        },
  )
