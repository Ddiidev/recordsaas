# RecordSaaS Desktop Agent Guide (Canonical)

Single source of truth for LLM-driven maintenance of the RecordSaaS desktop app (Electron + React + TypeScript, fork of ScreenArc).

## 0. Nao pode faltar ao compactar contexto

When compressing this file for a new AI session, these items are mandatory:
1. Read order: this file first (Section 8 workflow, Section 3 code map), then only domain-specific sections required by the task.
2. Section 2: Main/Preload/Renderer boundaries, IPC wiring, project flow, media URL invariant.
3. Section 4: store state fields, `.rsproj` compatibility defaults, sync offsets, export non-obvious invariants.
4. Section 5: UI token names (values in `src/index.css`), icon system, timeline geometry constants.
5. Section 8: H5/H4 file list, ring-based retrieval, workflow checkpoints.
6. Section 9: intent -> minimum files -> risk -> validation.
7. Section 10: renderer/main boundary, `.rsproj` compat, undo/redo, media ownership, lane precedence, scope.
8. Known defects (Section 11): confirmed by date — prevent regression.

## 1. Product Mission and Scope

Electron desktop app: screen recording, timeline editing, export. Fork of ScreenArc.
- Record full screen/window/area. Camera overlay + cursor effects. Layouts: `overlay`, `side-by-side`.
- Export video; persist/reload via `.rsproj`. Media audio import + lane control.
- Optional Windows/Linux computer-audio capture: Windows = bundled WASAPI loopback helper (AAC ADTS); Linux = FFmpeg `pulse` monitor.
- Scope boundaries: desktop-first; no multi-track media audio authoring; computer audio is simple `systemAudioPath` asset; macOS disabled in recorder UI.

## 2. Runtime Architecture

Layers:
- Main: `electron/main/` — file system, native dialogs, recording/export orchestration, session files.
- Preload: `electron/preload.ts` — strict contract glue. Any renderer-to-main capability must be mirrored in `ipc/index.ts` + `preload.ts`.
- Renderer: `src/` — UI state, timeline, preview, export payload assembly.

IPC: registration `electron/main/ipc/index.ts`, handlers `electron/main/ipc/handlers/*.ts`, renderer surface `window.electronAPI`.

Critical rules:
- Electron 41+ preloads must be CommonJS `.cjs`; use `build.rollupOptions.input` + CommonJS `output.format` in `vite.config.ts`, not top-level `entry`.
- Renderer uses `window.electronAPI` only; never raw `window.ipcRenderer`.
- Timer chip: content-protected window; starts visible only after internal `did-finish-load`, stays visible across workspaces/full screen, and uses a 44px green right-edge arrow tab. Arrow or `F2` expands leftward to show elapsed time, F2, marked-take count after the first mark, and explicit clickable Stop Recording; it still exposes only `recording:toggle-timer` through preload.
- Active recording hides the recorder window instead of minimizing it, so it does not create a Windows taskbar entry; stop/cancel restores the recorder window.
- During active recording, the system tray menu includes `Open Window`; it restores, shows, and focuses the recorder window.
- Session assets go in `~/.recordsaas/recording-YYYY-MM-DD_HH-mm-ss-*`, never loose in root.
- Recorder-to-editor handoff: `project:open` only after editor emits `editor:ready-for-project`; do not rely on `did-finish-load` alone.

Media URL invariant:
- Renderer media elements use `media://file?path=<encoded absolute path>`.
- `media` scheme registered with streaming privileges before `app.ready`, served via `protocol.handle` with HTTP `Range`/`206` support.
- Backward compatible with legacy `media://...` paths; never serialize `media://file?path=...` as real project path.

## 3. Code Map (Where to Read First)

Entry/app flow: `src/App.tsx`, `src/pages/RecorderPage.tsx`, `src/components/recorder/ImportProjectModal.tsx`, `src/lib/recorder-window.ts`, `src/pages/EditorPage.tsx`, `src/pages/RendererPage.tsx`

Store: root `src/store/editorStore.ts` (Zustand + Immer + Zundo). Slices in `src/store/slices/`: `projectSlice`, `timelineSlice`, `playbackSlice`, `frameSlice`, `audioSlice`, `uiSlice`, `presetSlice`, `webcamSlice`.

Timeline/media UI: `src/components/editor/Timeline.tsx`, `src/lib/takes.ts`, `src/components/editor/timeline/TakeTrack.tsx`, `src/components/editor/sidepanel/TakeSettings.tsx`, `src/components/editor/RegionSettingsPanel.tsx`, `src/components/editor/sidepanel/MediaAssetsPanel.tsx`, `src/components/editor/SidePanel.tsx`, `src/components/editor/timeline/*.tsx`

Preview/export: `src/components/editor/Preview.tsx`, `src/components/editor/PreviewControls.tsx`, `src/components/editor/ExportModal.tsx`, `src/hooks/useExportProcess.ts`, `src/pages/RendererPage.tsx`, `electron/main/features/export-manager.ts`

IPC/integration: `electron/main/ipc/index.ts`, handlers `media.ts`/`recording.ts`/`export.ts`/`file-system.ts`/`auth.ts`, `electron/main/features/recording-manager.ts`, `electron/preload.ts`, `electron/main/features/screen-encoder.ts`, `electron/main/features/windows-screen-capture.ts`, native helper `native/RecordSaaS.SystemAudio/Program.cs`

Types: `src/types/index.ts`, `src/types/screen-encoder.ts`
Release: `.github/workflows/release.yml`, `.releaserc.json`

## 4. State and Contract Baseline

Store: Zustand + Immer + Zundo. Undo/redo partialized to visual/timeline state only; operational state must not pollute history.

Media-audio contract state fields:
- `systemAudioPath`, `systemAudioUrl`, `systemAudioVolume`, `systemAudioMuted`
- `recordingSyncOffsetMs`, `systemAudioSyncOffsetMs` (per-source constant offset, ms; persisted in `.rsproj`; default `0`, clamp `[-10000,10000]`; positive delays, negative advances; preview: `targetTime = sourceTime + offsetSec`; export: `adelay`/`atrim`+`apad` via `applyAudioSyncOffset` in `export-manager.ts`)
- `mediaAudioClip`, `mediaAudioRegions`, `changeSoundRegions`
- `floatingMonitors`, `floatingMonitorRegions`

Take-mode contract: `takeModeEnabled` optional (defaults legacy); `sourceDuration` = physical length, `duration` = EDL length; `takes` order canonical, positions via `positionTakes`, never serialize destination starts; `takeTransitions` only adjacent, missing = hard cut; `currentTime` = composition time; lower timeline regions stay at absolute composition seconds; imported take video → app-owned storage + CFR GOP-2s proxy via `media:prepare-take-video`.

`.rsproj` compatibility defaults (when fields absent):
- `mediaAudioClip = null`, `mediaAudioRegions = {}`, `changeSoundRegions = {}`
- `webcamLayout = { mode: 'overlay', side: 'right', webcamWidthPercent: 30 }`, `swapRegions = {}`
- Imported `.rsproj` is source of truth for editor-authored state; canonical metadata only for capture-native data. Active preset is fallback for `webcamLayout`/`webcamPosition`/`webcamStyles`/`isWebcamVisible`; project-authored takes precedence.

Preset persistence: `Preset` stores `styles`, `aspectRatio`, `webcamLayout`, `webcamPosition`, `webcamStyles`, `isWebcamVisible`, `blurDefaults`, `swapDefaults`. Defaults control only new region insertion; editing existing region updates defaults but does not serialize regions into preset.

Webcam layout: `mode: overlay | side-by-side`; `side: left | right`; `webcamWidthPercent: int` (default 30); `shape: circle | square | rectangle | phone`; `crop: {top,right,bottom,left}` (default 0). `side-by-side` with padding 0 = no gap, camera not stretched. `swap` exchanges slots; destination styling belongs to arriving source. New recordings inherit from active preset before app defaults. Do not reintroduce playback-rate nudging or border snapping (rolled back during flicker investigation).

FloatingMonitor: imported visual asset with temporary editing timeline. First edit clones original as `<name> Edit` (`isEditedCopy=true`, green badge); re-edits reuse clone. On first edit, move instances pointing to original to clone before snapshot. `Show Cursor=false` on new asset edit. Image regions start at 5s. Asset editing snapshots/restores full mutable context; Media Audio belongs to local asset timeline; camera/recording audio isolated. Save canonicalizes nested drafts. Monitor regions never own swap. `CameraSwapRegion` swaps `origin`/`target` (`main-screen`/`webcam`/`floating-monitor-region` instance); equal/invalid = no render. Nested render reuses canvas by instance path; never allocate per frame. After composition replaces raw source, render with composition canvas dimensions. Legacy timelines may omit `cursorStyles`; inherit from parent context. On import, keep `timelineDuration` even if metadata is 0; constrain regions by it, not by `state.duration` until main metadata is positive.

Core audio rules: media audio follows `mediaAudioRegions` (independent from mic); `change-sound` affects only selected source; lane precedence = upper wins; region mute/volume/fade per track; computer audio follows main timeline + targetable by `change-sound`; final mix = recording + optional computer audio + media. Global Microphone/Computer Audio volume is linear through 100%; the 100-150% boost zone maps to 0..+24 dB. While boosted, preview routes active sources through one soft-knee master compressor plus an oversampled soft peak guard at -1.5 dB. Export uses lossless FLAC intermediates, applies a parallel soft-knee compressor before the lookahead limiter, keeps 5 dB of pre-AAC limiter headroom on processed tracks/final mix, and final `amix` must use `normalize=0` so mixing does not cancel the requested gain.

Media-audio cut adaptation ("Adaptar aos cortes"): `adaptMediaAudioToCuts(regionId)` in timelineSlice; algorithm in `src/lib/media-audio-cuts.ts`. Idempotency is geometric only (no serialized flag). Regions may extend past `state.duration` (no destructive clamp; export/preview clip tail). Button in `MediaAudioSettings`, disabled when `hasPendingCutAdaptation` false.

Export non-obvious invariants:
- Progress window, tray cancel, `powerSaveBlocker`, priority boost initialized before auth/audio/worker/FFmpeg.
- Library root: `storage.recordsaasRootPath` (default Documents/RecordSaaS). New project: no folder picker, validate name, save to `<root>/<name>/`. Existing name: replacement confirmation.
- Chunked MP4 via `fs:statFile`/`fs:readFileChunk` into MP4Box/WebCodecs (files >2GiB). Respect `MP4Box.appendBuffer` next offset; call `MP4Box.seek(0, true)` after extraction. Release samples after decode.
- RAM budget: `export.memoryLimitPercent`; `100%` < 70% physical RAM. Pause under pressure, fail with clear error.
- Clear stale `render:ready` before registering one-shot worker; `render:start` once per export.
- Progress: `export:render-progress` from renderer loop (VideoEncoder batches output). Throttle diagnostics. `exportSessionId` for correlation.
- Adaptive mode (default): preserve source dimensions + measured FPS. If FPS implausible but FFmpeg `tbr` sane, use nominal. Max 60fps export. Probe via FFmpeg metadata, not full-file parse. Webcam timing stays on source timeline (no rescale by duration ratio).
- WebCodecs: prefer hardware accel (decode/encode). H.264 Baseline preferred for throughput.
- Audio: no cuts/edits = reuse original file. Temp tracks = cancellable async FFmpeg (not `spawnSync`). Muxing copies AAC inputs (`.aac`/`.m4a`/`.mp4`); fallback encode for unknown codecs.
- Fade filters: never use `t` in FFmpeg `volume` expression without `:eval=frame` (default `once` evaluates at init with `t` undefined → `NaN` → aborts). `buildFadeVolumeFilter` in `export-manager.ts` uses `isnan` guard + `eval=frame`.
- Canvas: non-alpha, desynchronized 2D context. Cache keyed by output dims + source timestamp + visual state. `Object.values` caching by identity; never mutate in place. Cursor ripple = single backward metadata scan per frame.
- Progress window: poll `export-progress:get-state` fallback; main keeps direct DOM sync.
- Diagnostics: `npm run analyze:export-benchmark -- [logPath]`; `npm run verify:video-chunked-reader -- <path>` (>2GiB); `npm run verify:webcodecs-decode -- <path>` (missing frames). Log metrics inline as JSON strings.

IPC contracts:
- `media:import-audio` → `{canceled:true}` | `{canceled:false, asset:{path,name}}`. Media copied to runtime storage; original path never becomes session ownership.
- `fs:listSavedProjects` → `{success, rootPath, projects: SavedProjectListItem[]}` (fields: name, folderPath, projectFilePath, thumbnailPath?, thumbnailUrl?, recordedAt, sizeBytes, isLegacy).
- `recording:import-project-file` (from library modal) = same shape as `recording:import-project` (manual picker, compat path).

## 5. UI and Styling Baseline

Token source: `src/index.css`. Theme: `[data-theme='ocean-blue']` (light + `.dark`). Tokens: `--background`, `--foreground`, `--card`, `--primary`, `--primary-foreground`, `--muted`, `--accent`, `--border`, `--input`, `--ring`, `--sidebar`, `--sidebar-border`, `--timeline-tick`, `--speed-accent`. Dark inputs use `color-scheme: dark` + `--foreground` + matching caret. Use semantic classes (`text-foreground`, `bg-card`, `border-border`), never hard-code hex.

Fonts: `--font-sans: Inter`, `--font-heading: Outfit`. Radius: `--radius: 0.24rem` (mapped: sm/md/lg/xl). Prefer `rounded-md`/`rounded-lg`; `rounded-xl`/`full` only for avatars/handles/indicators.

Icons: `src/components/ui/icons.tsx` via `@icons`. Family: Iconoir (no mixing). `IconShell` for frames, `IconSwitch` for state transitions. Hover motion in `src/index.css` with `prefers-reduced-motion` fallback. Never import icon packages directly in feature files.

Component defaults (see source files for exact values):
- Buttons: `src/components/ui/button-variants.ts` — variants `default`/`secondary`/`outline`/`ghost`/`toolbar`; sizes `default h-9`/`sm h-8`/`lg h-10`/`icon h-9`.
- Input: `h-11 rounded-lg`. Select default `h-11`; minimal `h-9 border-border/40`.
- Slider track `h-2`; handle `w-[18px] h-[18px]`. Switch root `h-6 w-11`; thumb `h-4 w-4`.
- Collapse: `rounded-lg border bg-card`, trigger hover `bg-accent`. Context menu: translucent dark (`bg-zinc-900/60`); lane menu: themed `bg-card/95`. Tooltip: `rounded-md px-3 py-1.5`. Motion: 100-300ms color/opacity/transform.

Timeline geometry (`src/components/editor/Timeline.tsx`):
- `LANE_HEIGHT_PX=72`, `LANE_GAP_PX=8`, `RULER_HEIGHT_PX=48`, `LANE_ACTION_STRIP_WIDTH_PX=28`
- `TIMELINE_MIN_VISIBLE_LANES=2`, `TIMELINE_MAX_VISIBLE_LANES=3`
- Take mode: sticky ruler + sticky 64px EDL track. Region blocks `h-12`. Viewport buffer `+14px`.
- Resize handles centered on boundary, may extend outside; never both inside width (<40px). Visible only on select/hover. Cut blocks stay draggable after selection.
- Playhead: drag from full control line, `ew-resize`. Scrub: continuous from mousedown through window mousemove, clamp to duration, preserve playback state. `currentTime` = operational (never undo/redo); playhead subscription must not re-render full timeline.
- Scrub: coalesce with rAF, one decoder seek in flight, last target only, pause audio without timestamp changes. Final `seeked` listener before final seek, release scrub next frame. Fallback cap 1.5s. Preview must not subscribe full tree to `currentTime` during scrub (image-asset editing = exception, no video `seeked`).
- Preview: one pending rAF max; skip duplicate if `getVideoPlaybackQuality().totalVideoFrames` unchanged. `canvasDimensions` = canonical export geometry; preview uses capped backing raster.
- Audio/monitor seek: single-flight queue per `HTMLMediaElement`, last target only. Never write `currentTime` from every `timeupdate`. `play()` serialized; `AbortError` expected, retry once. Monitor `seeked` after main = schedule one redraw.
- Ruler/playhead listeners installed at `mousedown` (not post-render effect); fast click must not lose `mouseup`.

Content Root lane (`CONTENT_ROOT_LANE_ID='lane-content-root'`, locked, top): only holds `cut` + `change-sound`; nothing else. Shown only with content. `addCutRegion`/`addChangeSoundRegion` fix to it. Legacy `isCutLane`/`isChangeSoundLane` removed on load, remapped. Regular lanes never accept cut/change-sound. `getFallbackLaneId` excludes it. Height 30px, `inset-y-0` blocks, neutral fill, label `z-0`. New regions ~10% video duration, clamped to next neighbor/video end. `normalizeTimelineLanes` preserves flags on import. Viewport fits Content Root + 2-3 regular lanes. Horizontal buffer `max(TIMELINE_END_BUFFER_SECONDS, maxRegionEnd - duration)`.

Zoom: `w-24` slider + numeric, 1x-100x in 0.5x steps. Preserves playhead viewport coord by scaling `scrollLeft`. Recorder windows: toolbar 1220x200, preview 1220x420, settings 1380x820. Toolbar parity: Linux/macOS match Windows order. Click-through limited to win32/darwin; Linux stays interactive. Dropdowns temporarily disable click-through. Never leave click-through while pointer over toolbar.

Non-negotiable: token-driven colors; reuse `src/components/ui/*`; light/dark parity; keep `h-8/h-9/h-10/h-11` density; side panel tabs stable (`general, camera, audio, media, animation, cursor`); product identity `RecordSaaS`; icons via `@icons` only.

## 6. Feature Baseline: v2.4.2 Media Audio

- Media tab: `Audio`, `Image`, `Video`. Audio: import, timeline, preview, export. Windows WASAPI helper writes AAC ADTS directly (no PCM pipe to FFmpeg). Linux = FFmpeg Pulse/PipeWire. One media-audio clip per project. `change-sound` = recording-track control. Out of scope: multi-source mixing, multi-track authoring, advanced trim, full image/video render/export.

## 7. Desktop/API Integration

Integration points: `handlers/auth.ts`, `ipc/index.ts`, `handlers/shell.ts`. Affected by: token shape, billing/entitlement, URL/env contracts. Treat `recordsaas-api` as external dependency boundary.

Release CI: `.github/workflows/release.yml`. Windows = `windows-2022` (node-gyp@10 VS2022). Semantic-release creates tag first, build matrix uploads to that release. `ensure-binaries.mjs`: direct GitHub download (API fallback). Never `dotnet publish` native helper. Public assets: `RecordSaaSSetup-{mac,linux,windows}-v<version>.{zip,zip,exe}`.

## 8. Heatmap + Workflow

### Heatmap
- H5 (critical): `types/index.ts`, `projectSlice.ts`, `timelineSlice.ts`, `presetSlice.ts`, `preload.ts`, `ipc/index.ts`, `handlers/export.ts`, `handlers/file-system.ts`
- H4 (high): `Timeline.tsx`, `Preview.tsx`, `RegionSettingsPanel.tsx`, `MediaAssetsPanel.tsx`, `useTimelineInteraction.ts`, `useExportProcess.ts`
- H3 (feature): `SidePanel.tsx`, `EditorPage.tsx`, `RecorderPage.tsx`, `ExportModal.tsx`
- H2 (style): `index.css`, `sidepanel/*.tsx` (visual-only)
- H1 (docs): non-runtime text

### Workflow: Search → Analysis → Refinement → Coding → Validation
1. Classify domain; read minimum Section 3 files for it.
2. Confirm behavior from types + slice + UI/IPC; identify invariants.
3. Narrow to smallest safe edit; define contracts touched; pre-plan validation.
4. Apply minimal coherent edits across boundaries; keep type/store/UI/IPC synced; no opportunistic refactors.
5. Run targeted checks; verify compat defaults + regression flows; confirm no contract drift. For recorder toolbar: validate dropdown direction, label truncation, switching without background focus, click-through recovery after pointer leaves.

### Retrieval rings
Ring 1: entry + contract file. Ring 2: slice/handler + UI. Ring 3: related hook/handlers. Escalate to neighboring modules, then global grep only if contract ownership unknown.

## 9. Task Routing Matrix

| Intent | First files | Risk | Validation |
| --- | --- | --- | --- |
| UI tweak (tokens/panel) | `index.css`, `SidePanel.tsx`, `sidepanel/*.tsx` | Med | Light/dark visual + tab flow |
| Media-audio region bug | `types/index.ts`, `timelineSlice.ts`, `MediaAudioRegionBlock.tsx`, `MediaAssetsPanel.tsx` | High | Region create/move + playback sync |
| IPC media import | `ipc/index.ts`, `handlers/media.ts`, `preload.ts`, `MediaAssetsPanel.tsx` | High | Dialog path + runtime copy + response |
| Export mix regression | `useExportProcess.ts`, `projectSlice.ts`, `handlers/export.ts`, `ExportModal.tsx` | Crit | `verify:export-startup`; progress before heavy work; cancel works; mix + effects |
| `.rsproj` compat | `projectSlice.ts`, `presetSlice.ts`, `handlers/file-system.ts`, `types/index.ts` | Crit | Load legacy missing fields; safe defaults + preset precedence |
| Auth/session | `handlers/auth.ts`, `ipc/index.ts`, `preload.ts` | High | Session fetch/login/logout via IPC |
| Recorder toolbar/window | `RecorderPage.tsx`, `recorder-window.ts`, `electron/main/windows/recorder-window.ts` | High | Dropdown direction; label truncation; no background focus; click-through recovery |
| Screen capture/encoder | `windows-screen-capture.ts`, `screen-encoder.ts`, `recording-manager.ts`, `PerformanceTab.tsx`, `RecorderPage.tsx` | Crit | Probe encoder; Auto/manual/Generic warnings; mixed DPI; cursor once; hw vs CPU |
| Recorder-to-editor handoff | `RecorderPage.tsx`, `handlers/recording.ts`, `EditorPage.tsx` | High | Open/import starts editor with correct payload |
| Take recording/editor/export | `takes.ts`, `recording-manager.ts`, `TakeTrack.tsx`, `Preview.tsx`, `RendererPage.tsx`, `export-manager.ts` | Crit | EDL tests + global shortcut + boundary scrub + decode/probe export |
| Release CI | `release.yml`, `.releaserc.json`, `package.json` | High | Tag/version handoff + asset names + upload |

Simulation: UI tweak → H2/H3 first. Media-audio → H4/H5 first. IPC/export → H5 first.

## 10. Safe-Change Rules

1. Renderer/main strict: renderer never bypasses preload; new IPC = sync `ipc/index.ts` + handler + preload + renderer.
2. `.rsproj` compat: missing fields → safe defaults; never assume new fields in legacy.
3. Undo/redo: only visual/timeline state in history; no operational state.
4. Media ownership: runtime uses copied assets in app-owned path; original user files are not session-managed.
5. Lane precedence: upper wins; region edits keep valid bounds.
6. Scope discipline: request-specific only; no unrelated refactors in behavioral fixes.

## 11. Known Defects and Confirmed Regression Knowledge

- **2026-08-12 Audio boost cancellation**: `amix` defaults to normalization, so a two-track mix attenuates each input by 6 dB and can cancel a +6 dB boost exactly. Mix all tracks once with `normalize=0`, protect peaks with the shared limiter, and keep the Microphone `volume`/`isMuted` payload aligned with Computer Audio.
- **2026-08-06 GOP seekability**: NVIDIA low-latency screen path can produce CFR MP4 with only initial IDR (no explicit GOP). 588s/60fps artifact: seek at 563s took ~82s (decode from t=0). Fix: enforce bounded GOP ≤2s for screen+webcam outputs. Validate keyframe spacing + near-end seek. Sequential decode + nominal FPS do not prove seekability. Existing files need reencode; remux doesn't create keyframes.
- **2026-08-06 Persistent-seek amplifier**: Timeline 1.5s logical fallback clears in-flight flag while `video.seeking=true`; new target restarts decode from sole IDR; repeated jumps = indefinite hang. UI release ≠ physical decoder completion; latest-target queue must not treat timeout as `seeked`.
- **2026-08-07 Webcam desync (Windows)**: webcam records in separate FFmpeg process (`buildWin32SplitWebcamFfmpegSpecs`); PTS starts at DShow device open with no `-itsoffset`; export assumes `webcamTimestamp = sourceTimestamp`. Manual per-source sync offset is current correction; automatic recording-time compensation not implemented.
- **2026-06-22 WASAPI downmix**: devices like SteelSeries Sonar (8ch/7.1) lose ~10dB with standard FFmpeg downmix. Fix: `-af pan=stereo|c0=FL|c1=FR,aresample=async=1` (strict FL/FR capture, no matrix). Also: C# gap-filling changed from `Stopwatch` 40ms tolerance to `totalBytesWritten` tracking with 250ms tolerance (old 40ms injected micro-silence into valid samples). Preview decoupled: mic `volume`/`isMuted` must not apply to `systemAudio`/`mediaAudio` elements (they have own `systemAudioVolume`/`systemAudioMuted`).
- **Preview pipeline**: `systemAudioMuted=true` does not prevent decode. Muted raw ADTS can reach corrupt packet → Chromium `PIPELINE_ERROR_DECODE`. Muted + corrupt audio must be isolated from playback.
- **Composed preview**: gated by new main-screen frames. While main screen stuck seeking, duplicate-frame fast path skips webcam sync/drawing; both sources look frozen even when hidden webcam recovered. Diagnose element state separately from canvas result.

## Maintenance Rule

Update this file in same PR/commit when: architecture boundaries, IPC channels/preload API, store contracts, timeline region types, media-audio rules, compatibility defaults, UI token defaults, task routing, or heatmap change. Feature/fix incomplete if this file is stale.
