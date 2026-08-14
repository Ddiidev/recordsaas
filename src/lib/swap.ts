import type { CameraSwapRegion, SwapParticipant } from '../types'

export type SwapVisibility = Pick<CameraSwapRegion, 'hideOrigin'>
export type SwapFrameRect = { x: number; y: number; width: number; height: number }

export type SwapRenderPlan =
  | { kind: 'two-sided' }
  | { kind: 'target-only'; source: 'target'; destination: 'main-frame' }

export const sameSwapParticipant = (left: SwapParticipant, right: SwapParticipant): boolean =>
  left.kind === right.kind &&
  (left.kind !== 'floating-monitor-region' ||
    right.kind !== 'floating-monitor-region' ||
    left.regionId === right.regionId)

export const normalizeSwapVisibility = (value: Partial<SwapVisibility>): SwapVisibility => ({
  hideOrigin: value.hideOrigin === true,
})

export const setSwapOriginVisibility = (visible: boolean): SwapVisibility => ({ hideOrigin: !visible })

export const getSwapSlideStartConfig = <T extends SwapFrameRect>(
  target: SwapFrameRect,
  origin: SwapFrameRect,
  mainFrame: T,
): T => {
  const targetCenter = target.x + target.width / 2
  const originCenter = origin.x + origin.width / 2
  const direction = Math.sign(targetCenter - originCenter + Number.EPSILON)

  return { ...mainFrame, x: mainFrame.x + direction * mainFrame.width }
}

export const resolveSwapRenderPlan = (region: SwapVisibility): SwapRenderPlan => {
  if (normalizeSwapVisibility(region).hideOrigin)
    return { kind: 'target-only', source: 'target', destination: 'main-frame' }
  return { kind: 'two-sided' }
}
