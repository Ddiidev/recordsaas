import type { CutRegion, MediaAudioRegion } from '../types'
import { TIMELINE } from './constants'

const TOL = 0.05

const round = (value: number): number => Math.round(value * 1e6) / 1e6

const sortedRegions = (mediaAudioRegions: Record<string, MediaAudioRegion>): MediaAudioRegion[] =>
  Object.values(mediaAudioRegions).sort((a, b) => a.startTime - b.startTime)

const intersectsCut = (regions: MediaAudioRegion[], cs: number, ce: number): boolean =>
  regions.some((r) => r.startTime < ce - TOL && r.startTime + r.duration > cs + TOL)

const hasExactHole = (regions: MediaAudioRegion[], cs: number, ce: number): boolean =>
  regions.some(
    (a, i) =>
      i < regions.length - 1 &&
      Math.abs(a.startTime + a.duration - cs) <= TOL &&
      Math.abs(regions[i + 1].startTime - ce) <= TOL,
  )

export const hasPendingCutAdaptation = (
  cutRegions: Record<string, CutRegion>,
  mediaAudioRegions: Record<string, MediaAudioRegion>,
): boolean => {
  const regions = sortedRegions(mediaAudioRegions)
  if (regions.length === 0) return false

  for (const cut of Object.values(cutRegions)) {
    if (cut.duration <= TIMELINE.MINIMUM_REGION_DURATION) continue
    const cs = cut.startTime
    const ce = cut.startTime + cut.duration
    if (!intersectsCut(regions, cs, ce)) continue
    if (!hasExactHole(regions, cs, ce)) return true
  }
  return false
}

export const applyMediaAudioCutAdaptation = (
  cutRegions: Record<string, CutRegion>,
  mediaAudioRegions: Record<string, MediaAudioRegion>,
): string | null => {
  const cuts = Object.values(cutRegions)
    .filter((c) => c.duration > TIMELINE.MINIMUM_REGION_DURATION)
    .sort((a, b) => a.startTime - b.startTime)
  if (cuts.length === 0) return null

  let splitSeq = 0

  for (const cut of cuts) {
    const cs = cut.startTime
    const ce = cut.startTime + cut.duration
    const cutLength = ce - cs

    const regions = sortedRegions(mediaAudioRegions)
    if (!intersectsCut(regions, cs, ce)) continue
    if (hasExactHole(regions, cs, ce)) continue

    const splitTarget = regions.find((r) => r.startTime < cs - TOL && r.startTime + r.duration > cs + TOL)
    if (splitTarget) {
      const firstDuration = cs - splitTarget.startTime
      const secondDuration = splitTarget.startTime + splitTarget.duration - cs
      if (
        firstDuration < TIMELINE.MINIMUM_REGION_DURATION ||
        secondDuration < TIMELINE.MINIMUM_REGION_DURATION
      ) {
        continue
      }
      const previousFadeIn = splitTarget.fadeInDuration
      const previousFadeOut = splitTarget.fadeOutDuration

      splitTarget.duration = firstDuration
      splitTarget.fadeInDuration = Math.min(previousFadeIn, firstDuration)
      splitTarget.fadeOutDuration = 0

      splitSeq += 1
      const nextRegionId = `media-audio-${Date.now()}-${splitSeq}`
      mediaAudioRegions[nextRegionId] = {
        ...splitTarget,
        id: nextRegionId,
        startTime: cs,
        duration: secondDuration,
        sourceStart: splitTarget.sourceStart + firstDuration,
        fadeInDuration: 0,
        fadeOutDuration: Math.min(previousFadeOut, secondDuration),
      }
    }

    for (const region of Object.values(mediaAudioRegions)) {
      if (region.startTime >= cs - TOL) {
        region.startTime = round(region.startTime + cutLength)
      }
    }
  }

  const remaining = sortedRegions(mediaAudioRegions)
  return remaining.length > 0 ? remaining[0].id : null
}
