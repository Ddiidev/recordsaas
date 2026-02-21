export interface MetaDataItem {
  timestamp: number
  x: number
  y: number
  type: 'click' | 'move' | 'scroll'
  button?: string
  pressed?: boolean
  cursorImageKey?: string
}

export interface CursorFrame {
  width: number
  height: number
  xhot: number
  yhot: number
  delay: number
  rgba: Buffer
}

export type CursorTheme = Record<number, Record<string, CursorFrame[]>>
