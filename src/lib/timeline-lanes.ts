import { CutRegion, SpeedRegion, TimelineLane } from '../types'

type LaneAwareRegion = {
  id: string
  laneId?: string
  startTime: number
  duration: number
  zIndex?: number
}

export type TimelineSegment = {
  start: number
  end: number
  sourceDuration: number
  isCut: boolean
  speed: number
  exportDuration: number
}

export const DEFAULT_TIMELINE_LANE_ID = 'lane-1'
export const DEFAULT_TIMELINE_LANE_NAME = 'Lane 1'

export type LanePrecedenceContext = {
  normalizedLanes: TimelineLane[]
  laneIndexMap: Map<string, number>
  laneCount: number
}

type LanePrecedenceSource = TimelineLane[] | LanePrecedenceContext

const laneIndexMapCache = new WeakMap<TimelineLane[], Map<string, number>>()
const laneContextCache = new WeakMap<TimelineLane[], LanePrecedenceContext>()

export function createDefaultTimelineLane(): TimelineLane {
  return {
    id: DEFAULT_TIMELINE_LANE_ID,
    name: DEFAULT_TIMELINE_LANE_NAME,
    order: 0,
    visible: true,
    locked: false,
  }
}

export function sortTimelineLanes(lanes: TimelineLane[]): TimelineLane[] {
  return [...lanes].sort((a, b) => (a.order === b.order ? a.id.localeCompare(b.id) : a.order - b.order))
}

export function normalizeTimelineLanes(lanes: TimelineLane[] | null | undefined): TimelineLane[] {
  const source = lanes && lanes.length > 0 ? lanes : [createDefaultTimelineLane()]
  return sortTimelineLanes(source).map((lane, index) => ({ ...lane, order: index }))
}

export function getFallbackLaneId(lanes: TimelineLane[]): string {
  const sorted = sortTimelineLanes(lanes)
  return sorted[0]?.id ?? DEFAULT_TIMELINE_LANE_ID
}

export function buildLaneIndexMap(lanes: TimelineLane[]): Map<string, number> {
  const cached = laneIndexMapCache.get(lanes)
  if (cached) return cached

  const sorted = sortTimelineLanes(lanes)
  const laneIndexMap = new Map(sorted.map((lane, index) => [lane.id, index]))
  laneIndexMapCache.set(lanes, laneIndexMap)
  return laneIndexMap
}

export function createLanePrecedenceContext(lanes: TimelineLane[]): LanePrecedenceContext {
  const cached = laneContextCache.get(lanes)
  if (cached) return cached

  const normalizedLanes = normalizeTimelineLanes(lanes)
  const laneIndexMap = new Map(normalizedLanes.map((lane, index) => [lane.id, index]))

  const context: LanePrecedenceContext = {
    normalizedLanes,
    laneIndexMap,
    laneCount: normalizedLanes.length,
  }

  laneContextCache.set(lanes, context)
  laneIndexMapCache.set(normalizedLanes, laneIndexMap)
  return context
}

function resolveLanePrecedenceContext(source: LanePrecedenceSource): LanePrecedenceContext {
  if (Array.isArray(source)) {
    return createLanePrecedenceContext(source)
  }
  return source
}

export function isRegionActiveAtTime(region: Pick<LaneAwareRegion, 'startTime' | 'duration'>, time: number): boolean {
  return time >= region.startTime && time < region.startTime + region.duration
}

function laneIndexFor(region: LaneAwareRegion, laneIndexMap: Map<string, number>, laneCount: number): number {
  if (!region.laneId) return laneCount + 1
  return laneIndexMap.get(region.laneId) ?? laneCount + 1
}

export function compareRegionsByLanePrecedence(
  a: LaneAwareRegion,
  b: LaneAwareRegion,
  laneContext: LanePrecedenceContext,
): number {
  const { laneIndexMap, laneCount } = laneContext
  const laneDiff = laneIndexFor(a, laneIndexMap, laneCount) - laneIndexFor(b, laneIndexMap, laneCount)
  if (laneDiff !== 0) return laneDiff

  const zDiff = (b.zIndex ?? 0) - (a.zIndex ?? 0)
  if (zDiff !== 0) return zDiff

  const durationDiff = a.duration - b.duration
  if (durationDiff !== 0) return durationDiff

  const startDiff = b.startTime - a.startTime
  if (startDiff !== 0) return startDiff

  return a.id.localeCompare(b.id)
}

export function sortRegionsByLanePrecedence<T extends LaneAwareRegion>(regions: T[], source: LanePrecedenceSource): T[] {
  const laneContext = resolveLanePrecedenceContext(source)
  return [...regions].sort((a, b) => compareRegionsByLanePrecedence(a, b, laneContext))
}

export function getTopActiveRegionAtTime<T extends LaneAwareRegion>(
  regions: T[],
  time: number,
  source: LanePrecedenceSource,
): T | null {
  const laneContext = resolveLanePrecedenceContext(source)
  let topRegion: T | null = null

  for (const region of regions) {
    if (!isRegionActiveAtTime(region, time)) continue
    if (!topRegion || compareRegionsByLanePrecedence(region, topRegion, laneContext) < 0) {
      topRegion = region
    }
  }

  return topRegion
}

export function getTopRegionByPredicate<T extends LaneAwareRegion>(
  regions: T[],
  source: LanePrecedenceSource,
  predicate: (region: T) => boolean,
): T | null {
  const laneContext = resolveLanePrecedenceContext(source)
  let topRegion: T | null = null

  for (const region of regions) {
    if (!predicate(region)) continue
    if (!topRegion || compareRegionsByLanePrecedence(region, topRegion, laneContext) < 0) {
      topRegion = region
    }
  }

  return topRegion
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value))

export function buildTimelineSegments(
  duration: number,
  cutRegions: Record<string, CutRegion>,
  speedRegions: Record<string, SpeedRegion>,
  lanes: TimelineLane[],
): TimelineSegment[] {
  if (duration <= 0) return []

  const laneContext = createLanePrecedenceContext(lanes)
  const allCuts = Object.values(cutRegions)
  const allSpeeds = Object.values(speedRegions)
  const boundaries = new Set<number>([0, duration])

  allCuts.forEach((region) => {
    boundaries.add(clamp(region.startTime, 0, duration))
    boundaries.add(clamp(region.startTime + region.duration, 0, duration))
  })

  allSpeeds.forEach((region) => {
    boundaries.add(clamp(region.startTime, 0, duration))
    boundaries.add(clamp(region.startTime + region.duration, 0, duration))
  })

  const sortedBoundaries = Array.from(boundaries)
    .sort((a, b) => a - b)
    .filter((time, index, arr) => index === 0 || time !== arr[index - 1])

  const segments: TimelineSegment[] = []

  for (let i = 0; i < sortedBoundaries.length - 1; i++) {
    const start = sortedBoundaries[i]
    const end = sortedBoundaries[i + 1]
    const sourceDuration = end - start
    if (sourceDuration <= 0) continue

    const midpoint = start + sourceDuration / 2
    const activeCut = getTopActiveRegionAtTime(allCuts, midpoint, laneContext)
    const activeSpeed = getTopActiveRegionAtTime(allSpeeds, midpoint, laneContext)
    const speed = activeSpeed && activeSpeed.speed > 0 ? activeSpeed.speed : 1
    const isCut = !!activeCut

    segments.push({
      start,
      end,
      sourceDuration,
      isCut,
      speed,
      exportDuration: isCut ? 0 : sourceDuration / speed,
    })
  }

  return segments
}
