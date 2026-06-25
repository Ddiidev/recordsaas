export const LINUX_CURSOR_SCALE_OPTIONS = [
  { value: 2, label: '2x' },
  { value: 1.5, label: '1.5x' },
  { value: 1, label: '1x' },
] as const

export const RECORDER_WINDOW_SIZES = {
  toolbar: { width: 800, height: 600 },
  preview: { width: 800, height: 600 },
  settings: { width: 1380, height: 820 },
  importProject: { width: 800, height: 600 },
} as const

export type RecorderWindowPreset = keyof typeof RECORDER_WINDOW_SIZES

export const isLinuxCursorScaleOption = (
  value: number,
): value is (typeof LINUX_CURSOR_SCALE_OPTIONS)[number]['value'] =>
  LINUX_CURSOR_SCALE_OPTIONS.some((option) => option.value === value)
