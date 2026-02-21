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
  const sorted = sortTimelineLanes(lanes)
  return new Map(sorted.map((lane, index) => [lane.id, index]))
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
  laneIndexMap: Map<string, number>,
  laneCount: number,
): number {
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

export function sortRegionsByLanePrecedence<T extends LaneAwareRegion>(regions: T[], lanes: TimelineLane[]): T[] {
  const normalizedLanes = normalizeTimelineLanes(lanes)
  const laneIndexMap = buildLaneIndexMap(normalizedLanes)
  return [...regions].sort((a, b) => compareRegionsByLanePrecedence(a, b, laneIndexMap, normalizedLanes.length))
}

export function getTopActiveRegionAtTime<T extends LaneAwareRegion>(
  regions: T[],
  time: number,
  lanes: TimelineLane[],
): T | null {
  const activeRegions = regions.filter((region) => isRegionActiveAtTime(region, time))
  if (activeRegions.length === 0) return null
  return sortRegionsByLanePrecedence(activeRegions, lanes)[0]
}

export function getTopRegionByPredicate<T extends LaneAwareRegion>(
  regions: T[],
  lanes: TimelineLane[],
  predicate: (region: T) => boolean,
): T | null {
  const filtered = regions.filter(predicate)
  if (filtered.length === 0) return null
  return sortRegionsByLanePrecedence(filtered, lanes)[0]
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value))

export function buildTimelineSegments(
  duration: number,
  cutRegions: Record<string, CutRegion>,
  speedRegions: Record<string, SpeedRegion>,
  lanes: TimelineLane[],
): TimelineSegment[] {
  if (duration <= 0) return []

  const normalizedLanes = normalizeTimelineLanes(lanes)
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
    const activeCut = getTopActiveRegionAtTime(allCuts, midpoint, normalizedLanes)
    const activeSpeed = getTopActiveRegionAtTime(allSpeeds, midpoint, normalizedLanes)
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
