export const LINUX_CURSOR_SCALE_OPTIONS = [
  { value: 2, label: '2x' },
  { value: 1.5, label: '1.5x' },
  { value: 1, label: '1x' },
] as const

export const RECORDER_WINDOW_SIZES = {
  toolbar: { width: 980, height: 200 },
  preview: { width: 980, height: 420 },
  settings: { width: 980, height: 700 },
} as const

export type RecorderWindowPreset = keyof typeof RECORDER_WINDOW_SIZES

export const isLinuxCursorScaleOption = (
  value: number,
): value is (typeof LINUX_CURSOR_SCALE_OPTIONS)[number]['value'] =>
  LINUX_CURSOR_SCALE_OPTIONS.some((option) => option.value === value)
