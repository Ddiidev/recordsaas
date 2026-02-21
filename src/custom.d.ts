import 'react'

declare global {
  interface HTMLVideoElement {
    // For Firefox
    mozHasAudio?: boolean
    // For WebKit/Blink browsers
    webkitHasAudio?: boolean
    // For standard audioTracks (though it might not be fully supported in all browsers)
    audioTracks?: {
      length: number
      [index: number]: {
        kind: string
        label: string
        language: string
        enabled: boolean
      }
    }
  }
}

declare module 'react' {
  interface CSSProperties {
    WebkitAppRegion?: 'drag' | 'no-drag' | 'drag-window' | 'no-drag-window'
    // Add other custom CSS properties here if needed
  }
}

declare module 'mp4box' {
  const MP4Box: unknown
  export default MP4Box
}
