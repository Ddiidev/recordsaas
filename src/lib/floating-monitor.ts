import type { FloatingMonitor, FloatingMonitorRegion } from '../types'

export const findEditedMonitorClone = (
  monitors: Record<string, FloatingMonitor>,
  monitor: FloatingMonitor,
): FloatingMonitor | undefined => {
  if (monitor.isEditedCopy) return monitor

  const originalName = monitor.originalName || monitor.name
  return Object.values(monitors).find(
    (candidate) => candidate.isEditedCopy && candidate.originalName === originalName && candidate.path === monitor.path,
  )
}

export const resolveMonitorForAssetTimeline = (
  monitors: Record<string, FloatingMonitor>,
  monitorId: string,
): FloatingMonitor | undefined => {
  const monitor = monitors[monitorId]
  if (!monitor) return undefined
  return findEditedMonitorClone(monitors, monitor) || monitor
}

export const normalizeAssetTimelineMonitorRegions = (
  regions: Record<string, FloatingMonitorRegion>,
  monitors: Record<string, FloatingMonitor>,
) => {
  Object.values(regions).forEach((region) => {
    const monitor = resolveMonitorForAssetTimeline(monitors, region.monitorId)
    if (monitor) region.monitorId = monitor.id
  })
}
