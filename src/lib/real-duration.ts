import type { CutRegion, SpeedRegion } from '../types'

export function calcRealDuration(
  duration: number,
  cutRegions: Record<string, CutRegion>,
  speedRegions: Record<string, SpeedRegion>,
): number {
  if (duration === 0) return 0

  let finalDuration = duration

  Object.values(cutRegions).forEach((region) => {
    finalDuration -= region.duration
  })

  Object.values(speedRegions).forEach((region) => {
    finalDuration -= region.duration
    finalDuration += region.duration / region.speed
  })

  return Math.max(0, finalDuration)
}