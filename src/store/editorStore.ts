import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { temporal } from 'zundo'
import { shallow } from 'zustand/shallow'
import { useShallow } from 'zustand/react/shallow'
import debounce from 'lodash.debounce'

import type { EditorState } from '../types'
import type { EditorActions as AllActions } from '../types'
import { createProjectSlice, initialProjectState } from './slices/projectSlice'
import { createPlaybackSlice, initialPlaybackState } from './slices/playbackSlice'
import { createFrameSlice, initialFrameState } from './slices/frameSlice'
import { createTimelineSlice, initialTimelineState } from './slices/timelineSlice'
import { createPresetSlice, initialPresetState } from './slices/presetSlice'
import { createWebcamSlice, initialWebcamState } from './slices/webcamSlice'
import { createUISlice, initialUIState } from './slices/uiSlice'
import { createAudioSlice, initialAudioState } from './slices/audioSlice'

// Combine all actions into one type for the final store
type EditorStore = EditorState & AllActions

export const useEditorStore = create(
  temporal(
    immer<EditorStore>((set, get) => ({
      // Combine initial states from all slices
      ...initialProjectState,
      ...initialPlaybackState,
      ...initialFrameState,
      ...initialTimelineState,
      ...initialPresetState,
      ...initialWebcamState,
      ...initialUIState,
      ...initialAudioState,

      // Combine actions from all slices
      ...createProjectSlice(set, get),
      ...createPlaybackSlice(set, get),
      ...createFrameSlice(set, get),
      ...createTimelineSlice(set, get),
      ...createPresetSlice(set, get),
      ...createWebcamSlice(set, get),
      ...createUISlice(set, get),
      ...createAudioSlice(set, get),

      // Global reset action
      reset: () =>
        set((state) => {
          Object.assign(
            state,
            initialProjectState,
            initialPlaybackState,
            initialFrameState,
            initialTimelineState,
            initialAudioState,
          )
          // App-level state like presets and theme are not reset here
        }),
    })),
    {
      // Configuration for Zundo (undo/redo)
      partialize: (state) => {
        // Only include properties that should be part of the undo/redo history.
        const {
          frameStyles,
          aspectRatio,
          zoomRegions,
          cutRegions,
          speedRegions,
          blurRegions,
          swapRegions,
          mediaAudioRegions,
          changeSoundRegions,
          timelineLanes,
          presets,
          activePresetId,
          webcamPosition,
          webcamStyles,
          isWebcamVisible,
        } = state

        return {
          frameStyles,
          aspectRatio,
          zoomRegions,
          cutRegions,
          speedRegions,
          blurRegions,
          swapRegions,
          mediaAudioRegions,
          changeSoundRegions,
          timelineLanes,
          presets,
          activePresetId,
          webcamPosition,
          webcamStyles,
          isWebcamVisible,
        }
      },
      equality: shallow,
      handleSet: (handleSet) => debounce(handleSet, 500),
    },
  ),
)

// --- Custom Hooks for specific state parts ---

/**
 * Hook to select only playback-related state, optimized with shallow comparison.
 */
export const usePlaybackState = () =>
  useEditorStore(
    useShallow((state) => ({
      currentTime: state.currentTime,
      duration: state.duration,
      isPlaying: state.isPlaying,
      isCurrentlyCut: state.isCurrentlyCut,
    })),
  )

/**
 * Hook to select only frame style state, optimized with shallow comparison.
 */
export const useFrameStyles = () => useEditorStore(useShallow((state) => state.frameStyles))

/**
 * Hook to select all timeline regions, optimized with shallow comparison.
 */
export const useAllRegions = () =>
  useEditorStore(
    useShallow((state) => ({
      zoomRegions: state.zoomRegions,
      cutRegions: state.cutRegions,
      speedRegions: state.speedRegions,
      blurRegions: state.blurRegions,
      swapRegions: state.swapRegions,
      mediaAudioRegions: state.mediaAudioRegions,
      changeSoundRegions: state.changeSoundRegions,
    })),
  )
