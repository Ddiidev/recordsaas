# RecordSaaS Desktop Agent Guide (Canonical)

This is the single source of truth for LLM-driven maintenance of the RecordSaaS desktop application.

Use this file to avoid full-repo re-analysis on every request.
Default execution flow: read Section 8 (workflow), then Section 3 (code map), then only the domain-specific sections required by the task.
LLM obligation: if code behavior, contracts, or UI/system conventions change, this file must be updated in the same change set.
Primary maintenance target in this repo is `AGENTS.MD` (and `agent.md` only if that file exists as an additional guide).

## 1. Product Mission and Current Scope (Desktop-First)

RecordSaaS is an Electron desktop app for screen recording, timeline editing, and export.
It is a heavily customized fork of ScreenArc, with product identity and UX focused on RecordSaaS.

Current scope baseline:
- Record full screen, window, or selected area.
- Edit capture in timeline with lane-based regions and visual effects.
- Support camera overlay and cursor/animation effects.
- Support camera layouts in `overlay` and `side-by-side` modes.
- Export final output (video and related formats).
- Persist and reload projects through `.rsproj`.
- Support media audio asset import and lane-based control (v2.4.2 baseline).
- Support optional Windows/Linux computer-audio capture as a simple separate recording asset: Windows uses the bundled native WASAPI loopback helper to write AAC ADTS directly, including timeline silence; Linux uses FFmpeg `pulse` monitor capture.

Hard scope boundaries for current cycle:
- Desktop-first guidance (not landing-page-first).
- API context included only where desktop behavior depends on it.
- No assumption of multi-track media audio authoring beyond current implemented contracts.
- Computer audio remains a simple `systemAudioPath` project asset with editor-level volume/mute controls; macOS stays disabled in the recorder UI for now, and we do not introduce `recordingAudioTracks` or per-source `change-sound`.

## 2. Runtime Architecture (Main, Preload, Renderer, IPC Boundaries)

Core runtime layers:
- Main process: `electron/main/`
- Preload bridge: `electron/preload.ts`
- Renderer app: `src/`

IPC wiring baseline:
- Channel registration: `electron/main/ipc/index.ts`
- Main handlers: `electron/main/ipc/handlers/*.ts`
- Renderer bridge surface: `window.electronAPI` in `electron/preload.ts`

Responsibility boundaries:
- Main process owns file system access, native dialogs, shell integration, recording orchestration, export orchestration, and runtime session file handling.
- Renderer owns UI state, timeline interactions, preview composition, and payload assembly for export/import flows.
- Preload is strict contract glue. Any renderer-to-main capability must be mirrored in both `ipc/index.ts` and `preload.ts`.
- Electron 41+ preloads must be emitted as CommonJS `.cjs` files; do not let `vite-plugin-electron` emit ESM preload files for `BrowserWindow.webPreferences.preload`.
- In `vite.config.ts`, preload builds must use `build.rollupOptions.input` plus CommonJS `output.format`; do not use the top-level `entry` shortcut for preloads because package `"type": "module"` makes `vite-plugin-electron` add an ES-module output.
- Renderer code must use `window.electronAPI` only; do not depend on a raw `window.ipcRenderer` global.

Project/runtime flow:
1. Session assets are created/copied into a timestamped runtime storage subfolder (`~/.recordsaas/recording-YYYY-MM-DD_HH-mm-ss-*`). Do not place new recording files loose in the root `~/.recordsaas` directory.
2. Renderer loads project payload and hydrates store state.
3. Editing and preview happen entirely in renderer state.
4. Export payload is sent to main process for final processing.
5. Session cleanup is triggered on editor closure per runtime policy.

Recorder-to-editor handoff invariant:
- Main process stores the current session payload and sends `project:open` only after the editor renderer has registered its listener and emitted `editor:ready-for-project`; do not rely on `did-finish-load` alone for project delivery.

Recording profile invariant:
- Recorder startup must offer a recording profile dropdown in place of the old local-video load button. The default profile is `Native Adaptive (Recommended)`.
- The recording profile dropdown includes profile items first, then a separator and a `Create profile` action that opens `Settings > Recording` and starts a new editable profile.
- Recording profiles control capture-time screen/webcam resolution, FPS, and audio compression defaults (`AAC | MP3`, bitrate, sample rate); export settings remain independent. During export, adaptive/native mode uses the actual recorded video properties, not the selected profile object.
- The native adaptive recording profile keeps its video settings managed by analysis. Its screen FPS can be updated by the 60fps capability analysis tool; webcam capture stays at 30fps and requests the selected screen/area capture resolution. Audio compression settings on that profile remain user-editable.
- The 60fps capability analysis tool should run a 5-second screen capture probe and show an in-button countdown/spinner while it is measuring so users understand the wait is intentional. On Windows, prefer FFmpeg `ddagrab`/Desktop Duplication for this probe and fall back to `gdigrab` only if Desktop Duplication fails to produce a measurable result.
- On first recorder startup, if there is no valid stored native recording capability analysis, open `Settings > Recording` and trigger that analysis automatically before the user relies on the default profile FPS.
- The recorder control window should stay interactive instead of using click-through behavior that sends clicks to the app behind it on Windows/macOS. Transparent chrome is fine; pointer input should land on the recorder controls.
- When the recorder opens `Settings`, keep the window interactive (`setIgnoreMouseEvents(false)`) and render the modal in an isolated top stacking context; do not rely on transparent-window hit-testing for the close button.
- On Windows, webcam capture options must be probed before recording when an explicit size is requested. If DShow rejects the target size, fall back to a supported common size or device default instead of aborting the recording.
- On Windows, when webcam capture is enabled, screen capture and webcam capture must run in separate FFmpeg processes. Keep screen+mic in the main process and webcam in an auxiliary process so a slow DShow camera cannot starve `ddagrab` screen frames. Stop/cancel paths must shut down every FFmpeg process before validating or discarding session files.
- On Windows, pass the friendly DShow device name to FFmpeg (`deviceLabel`); keep the alternative/PnP identifier only as the persisted selection id. Do not use the PnP id as `video=` or `audio=` input text.
- The Windows DShow webcam probe must require at least one captured frame, not only a successful device open/exit code. If the device returns zero frames, stop before starting the rest of the recording and show a camera-busy/driver diagnostic.
- On Windows, DShow webcam capture should use enlarged input buffering (`thread_queue_size`/`rtbufsize`) and should fall back from requested 60fps to 30fps when the camera rejects 60fps. Do not lower screen FPS just because the webcam only supports 30fps.
- Never apply Windows `PRIORITY_LOW`/Idle to the DShow webcam process; use at least `PRIORITY_BELOW_NORMAL` so it can deliver the first frame.
- Custom profiles may choose screen resolution `native | sd | hd | full-hd | 2k`, screen FPS `30 | 60 | 120`, webcam resolution `native | sd | hd | full-hd | 2k`, and webcam FPS `synced | 30 | 60`; synced webcam FPS follows the screen FPS capped at 60fps.
- Performance settings own `general.forceHighPerformanceGpu`, `export.memoryLimitPercent`, and FFmpeg recording process priority. General settings must not duplicate those controls.
- General setting `general.recordingProcessPriority` controls FFmpeg recording process scheduling with `low | normal | high | advanced`. On Windows, `normal` intentionally maps to below-normal OS priority, `low` maps to low priority, and `high` maps to above-normal without using realtime/admin-only priority.
- When `general.recordingProcessPriority` is `advanced`, `general.recordingProcessPriorities` applies per FFmpeg role: `main` for screen/mic, `webcam` for separate webcam capture, and `systemAudio` for computer-audio recording/encoding.
- Saved screen MP4 output must preserve the requested profile FPS as CFR on the output side. Capture inputs such as Windows `gdigrab` can expose sparse/VFR average FPS even when requested at 30fps; do not let new recordings persist as low-FPS screen files when the profile requested 30/60/120fps.
- Recording metadata should include optional diagnostic fields for the screen capture backend, requested screen FPS, and FFmpeg version so future low-FPS investigations can confirm whether the recording used `ddagrab`, `gdigrab`, `x11grab`, or `avfoundation` and which bundled asset produced the file.
- Webcam capture size/FPS remain profile-controlled, but the saved webcam MP4 must use controlled `libx264` CRF/VBV settings instead of mirroring the high-quality screen encoder. Keep webcam bitrate bounded for long/noisy recordings so camera files do not grow into multi-GB artifacts.

Media URL invariant:
- Absolute local media paths exposed to renderer media elements use `media://file?path=<encoded absolute path>`.
- The `media` scheme must be registered with streaming privileges before app `ready`, and served through `protocol.handle` with direct file streaming plus HTTP `Range`/`206 Partial Content` support so Chromium's media pipeline can seek MP4/audio sources reliably.
- The `media` protocol and project import/export normalization must remain backward compatible with legacy `media://...` paths and must not serialize `media://file?path=...` as a real project path.

## 3. Source-of-Truth Code Map (Where to Read First)

### 3.1 Entry and app flow
- `src/App.tsx`
- `src/pages/RecorderPage.tsx`
- `src/components/recorder/ImportProjectModal.tsx`
- `src/lib/recorder-window.ts`
- `src/pages/EditorPage.tsx`
- `src/pages/RendererPage.tsx`

### 3.2 Store and domain state
- Store root: `src/store/editorStore.ts`
- Domain slices:
- `src/store/slices/projectSlice.ts`
- `src/store/slices/timelineSlice.ts`
- `src/store/slices/playbackSlice.ts`
- `src/store/slices/frameSlice.ts`
- `src/store/slices/audioSlice.ts`
- `src/store/slices/uiSlice.ts`
- `src/store/slices/presetSlice.ts`
- `src/store/slices/webcamSlice.ts`

### 3.3 Timeline and media UI
- Timeline shell: `src/components/editor/Timeline.tsx`
- Region settings: `src/components/editor/RegionSettingsPanel.tsx`
- Media panel: `src/components/editor/sidepanel/MediaAssetsPanel.tsx`
- Side panel routing: `src/components/editor/SidePanel.tsx`
- Region blocks: `src/components/editor/timeline/*.tsx`

### 3.4 Preview and export
- Preview: `src/components/editor/Preview.tsx`
- Preview controls: `src/components/editor/PreviewControls.tsx`
- Export UI flow: `src/components/editor/ExportModal.tsx`
- Export orchestration hook: `src/hooks/useExportProcess.ts`

### 3.5 IPC and desktop integration
- IPC registration: `electron/main/ipc/index.ts`
- Media import handler: `electron/main/ipc/handlers/media.ts`
- Recording handlers: `electron/main/ipc/handlers/recording.ts`
- Export handlers: `electron/main/ipc/handlers/export.ts`
- File/project handlers: `electron/main/ipc/handlers/file-system.ts`
- Auth handlers: `electron/main/ipc/handlers/auth.ts`
- Preload API surface: `electron/preload.ts`
- Screen encoder resolver/probes: `electron/main/features/screen-encoder.ts`
- Windows monitor capture mapper: `electron/main/features/windows-screen-capture.ts`
- Windows system-audio helper entrypoint: `native/RecordSaaS.SystemAudio/Program.cs`
- Windows system-audio helper buffering/timeline: `native/RecordSaaS.SystemAudio/BlockingWaveProvider.cs`, `native/RecordSaaS.SystemAudio/TimelineWaveWriter.cs`

### 3.6 Types and contracts
- Canonical app types: `src/types/index.ts`
- Screen encoder settings/status contract: `src/types/screen-encoder.ts`

### 3.7 Release automation
- Release workflow: `.github/workflows/release.yml`
- Semantic-release config: `.releaserc.json`

## 4. State and Contract Baseline (Store, Regions, Serialization)

Store composition:
- Global store uses Zustand + Immer + Zundo in `src/store/editorStore.ts`.
- Undo/redo history is intentionally partialized to visual/timeline state; operational state must not pollute history.

Media-audio contract state:
- `systemAudioPath: string | null`
- `systemAudioUrl: string | null`
- `systemAudioVolume: number`
- `systemAudioMuted: boolean`
- `mediaAudioClip: MediaAudioClip | null`
- `mediaAudioRegions: Record<string, MediaAudioRegion>`
- `changeSoundRegions: Record<string, ChangeSoundRegion>`
- `floatingMonitors: Record<string, FloatingMonitor>` and `floatingMonitorRegions: Record<string, FloatingMonitorRegion>`

Canonical contract fields:
- `MediaAudioClip`: `id`, `path` (runtime absolute), `url` (`media://...`), `name`, `duration`, `startTime`.
- `MediaAudioRegion`: `id`, `type='media-audio'`, `laneId`, `startTime`, `duration`, `sourceStart`, `isMuted`, `volume`, `fadeInDuration`, `fadeOutDuration`, `zIndex`.
- `ChangeSoundRegion`: `id`, `type='change-sound'`, `laneId`, `startTime`, `duration`, `sourceKey='recording-mic' | 'system-audio'`, `isMuted`, `volume`, `fadeInDuration`, `fadeOutDuration`, `zIndex`.
- `FloatingMonitor`: imported visual asset with an independent temporary editing timeline (`timelineStart`, `timelineDuration`) and normalized overlay geometry. A timeline edit always clones the selected asset as `<originalName> Edit`, preserving `originalName` for its monitor badge and `isEditedCopy=true` for its green `Edit` thumbnail badge; the source remains untouched. `FloatingMonitorRegion` places the source or its completed nested composition on the main timeline with `monitorId`, `sourceStart`, lane precedence, duration, crop, border/radius, flip, and shadow settings. The temporary asset timeline persists its own `floatingMonitorRegions`; nested rendering must be isolated so it never replaces or paints over the main frame while the region is a monitor. Only explicit `swapWithMain` may occupy the main frame.

Core business rules:
1. Media audio playback follows `mediaAudioRegions` and is independent from recording-mic source.
2. `change-sound` regions affect only their selected source (`recording-mic` or `system-audio`); regions from one source must not change lane precedence, volume, mute, or fades on the other source.
3. Lane precedence applies when overlaps occur (upper lane wins).
4. Region-level mute/volume/fade are enforced on applicable tracks.
5. Computer audio follows the main recording timeline, supports whole-track editor volume/mute, and can be targeted by `change-sound` regions.
6. Final mix includes recording + optional computer audio + media when present.
7. Image media can remain placeholder if no render/export behavior is implemented.
8. Imported video/image assets are visual floating monitors. Open one from `Media` to edit its temporary timeline, then add it to the main timeline. Preview and WebCodecs export render the raw source only inside active monitor regions; monitor crop/style controls match the camera control model, while video-audio mixing remains owned by the audio asset flow.

Export startup invariant:
- The export progress window, tray cancel path, `powerSaveBlocker`, and process-priority boost must be initialized before authorization, audio preparation, worker loading, or FFmpeg work.
- The default RecordSaaS library root is stored in `storage.recordsaasRootPath` and defaults to the user Documents folder plus `RecordSaaS`. Project export and render path resolution must use main-process helpers rather than hard-coded renderer path assembly.
- When rendering without an active project folder, the output path must resolve under `<RecordSaaS root>/General/`. When rendering from an active project, the active project folder remains the output base.
- Exporting a new project must not show a folder picker. The renderer should request a project name, validate it through the main process, and save to `<RecordSaaS root>/<validated project name>/`.
- Project folder names must be validated against the current OS folder-name rules before saving; do not accept path separators, reserved Windows device names, trailing Windows dots/spaces, control characters, or empty names.
- When saving a new project to a name whose folder already exists, the main process must show a replacement confirmation before writing. Choosing `Substituir` deletes that existing project folder and saves the new project there; choosing `OK` cancels the save and returns the user to the naming popup.
- Saving a project should write `project.rsproj`, copy owned media into the project folder, and create hidden sidecar `.thumbnail.png` from the main screen video. Thumbnail failures may be logged without corrupting the project save.
- The recorder import flow should open the in-app project library modal first. That modal lists direct child folders under the configured RecordSaaS root that contain `project.rsproj`, shows `.thumbnail.png` when present, and uses file/folder timestamp plus folder size fallbacks for legacy projects.
- Manual `.rsproj` import through the OS file picker remains available from the import modal and continues to use the existing Explorer/Finder flow.
- Renderer video export must not load full local MP4 files into a single renderer/main-process buffer. Screen and webcam video decoding should stream chunks through `fs:statFile` and `fs:readFileChunk` into MP4Box/WebCodecs so projects with files larger than 2GiB remain exportable.
- Chunked MP4 pumps must respect the next offset returned by `MP4Box.appendBuffer` and call `MP4Box.seek(0, true)` after extraction starts; many recordings keep `moov` at EOF, and linear chunk feeding can reach `onReady` without extracting any main-video samples.
- Chunked MP4/WebCodecs export must release MP4Box samples after they are submitted to the decoder and must size chunk, decode, frame, and encoder queues from the configured export RAM budget. The user-facing RAM setting is stored as `export.memoryLimitPercent`; `100%` maps to a process budget below 70% of physical RAM, not to all installed memory. The renderer should pause MP4 pumping/rendering under memory pressure and fail with a clear budget error instead of continuing to grow unbounded.
- Export startup must clear stale `render:ready` listeners before registering the current one-shot worker listener; a single export must send `render:start` only once.
- Render progress must be emitted from the renderer loop through `export:render-progress`; do not rely only on encoded frame/chunk delivery because `VideoEncoder` can batch output and hide 0-100% progress.
- Renderer-loop progress IPC and diagnostics must stay throttled/bucketed; never log or send redundant progress for every frame on long exports.
- Render performance diagnostics should be aggregate periodic metrics (decode, draw, encoder backpressure, encode), not per-frame logs.
- Export diagnostics must carry an `exportSessionId` generated by the main process and forwarded to the render worker/progress payloads so main, renderer, progress-window, FFmpeg, and completion logs can be correlated for one export run.
- Long-export benchmark reviews should use `npm run analyze:export-benchmark -- [logPath]` after the run to summarize startup, adaptive/effective export settings, render loop, finalization, encoder config, and renderer perf samples.
- Export benchmark analysis must report both the latest started export and the last completed export so interrupted/stalled runs are not hidden by older successful runs.
- Chunked MP4 parser regressions can be checked with `npm run verify:video-chunked-reader -- <absolute-video-path>`; use this for projects with screen or webcam files larger than 2GiB before relying on a full UI export run.
- Electron WebCodecs decode regressions can be checked with `npm run verify:webcodecs-decode -- <absolute-video-path>`; use this when export fails with missing decoded frames even though MP4Box metadata is available.
- Renderer performance metric logs must serialize payloads inline as JSON strings; Electron console forwarding may collapse object arguments to `[object Object]`.
- WebCodecs export should prefer hardware acceleration for decode and encode where Chromium supports it; do not remove this preference without benchmark evidence.
- WebCodecs H.264 export should prefer Baseline Profile for throughput on current benchmark hardware; High Profile may be tried only as a fallback or with benchmark evidence that it improves completion time.
- Adaptive export mode is the default user-facing export mode: it must preserve the recorded screen video's source dimensions and measured average source FPS while keeping quality configurable. If the measured average FPS is implausibly low but FFmpeg reports a sane nominal `tbr` such as 30/60/120, use the nominal FPS so export does not propagate sparse/VFR capture metadata as a 3-4fps output. Export FPS remains capped to the currently supported export tiers, max 60fps, until UI/API authorization explicitly support 120fps. Manual resolution/FPS controls are available only when adaptive mode is disabled.
- Export settings UI in adaptive mode should probe the loaded source video and reflect the real source FPS in the disabled FPS field instead of leaving the last persisted default `30fps` on screen. The modal should not mislead the user when the source video is actually 60fps.
- Webcam export timing must stay aligned to the same source timeline as the main recording. Do not rescale webcam timestamps by the duration ratio between files to "fit" the main track; the output FPS already determines final cadence, and webcam frames should repeat or hold naturally when their own source FPS is lower.
- Adaptive export authorization must map the measured source height/FPS to the nearest supported billing tier without changing the renderer payload contract used for manual exports.
- Adaptive source probing in the main process should use FFmpeg metadata probing, not full-file MP4 parsing, so long recordings do not add a new pre-render I/O stall.
- The hidden export renderer canvas should request a non-alpha, desynchronized 2D context to reduce compositor synchronization overhead during long renders.
- Renderer canvas composition may cache frame-invariant background, geometry primitives, and repeated media-frame layers, but caches must be keyed by output dimensions, source frame timestamp, and visual state so edits/export settings cannot reuse stale visuals.
- Renderer export helpers may cache `Object.values` for region maps by object identity to avoid per-frame allocations; never mutate cached region arrays in place.
- Cursor rendering should derive ripple and click-scale state from a single backward metadata scan per frame; avoid separate metadata scans for each cursor effect.
- Zoom/cursor transform helpers may memoize metadata-derived calculations by metadata array identity and exact timestamp; do not approximate cursor/zoom math unless the visual tolerance is explicitly defined.
- The export progress window must also be able to poll `export-progress:get-state` from main state, so delayed temp-window loading or missed push events cannot leave the widget stuck at `0%`.
- The main process must keep a direct DOM sync fallback for the export progress window after each accepted progress update; the tiny temporary window must not depend solely on its preload listener/polling JavaScript to render 0-100% progress.
- Recording audio with no cuts, speed regions, or `change-sound` edits must reuse the original audio file instead of pre-rendering a full-length processed track.
- Audio preparation that must render temporary tracks should run through cancellable asynchronous FFmpeg processes, not blocking `spawnSync` calls on the main process.
- Final MP4 muxing should copy already-AAC audio inputs (`.aac`, `.m4a`, `.mp4`) instead of re-encoding them; only fall back to AAC encoding for unknown audio containers/codecs.

IPC contract baseline (media import):
- Channel: `media:import-audio`
- Return union:
- `{ canceled: true }`
- `{ canceled: false, asset: { path: string, name: string } }`
- Mandatory rule: selected media is copied into runtime storage (`~/.recordsaas`); original user path must not become session ownership.

IPC contract baseline (project library/import):
- Channel: `fs:listSavedProjects`
- Return union:
- `{ success: true, rootPath: string, projects: SavedProjectListItem[] }`
- `{ success: false, rootPath?: string, error: string }`
- `SavedProjectListItem` includes `name`, `folderPath`, `projectFilePath`, optional `thumbnailPath`/`thumbnailUrl`, `recordedAt`, `sizeBytes`, and `isLegacy`.
- Channel: `recording:import-project-file`
- Input: absolute `.rsproj` path selected from the library modal.
- Return shape matches `recording:import-project`.
- Manual picker channel `recording:import-project` remains the compatibility path for files outside the configured RecordSaaS root.

`.rsproj` compatibility baseline:
- Serialized fields of interest include `mediaAudioClip`, `mediaAudioRegions`, `changeSoundRegions`.
- Serialized camera/layout fields of interest include `webcamLayout`, `webcamPosition`, `webcamStyles`, `isWebcamVisible`, `swapRegions`.
- Imported `.rsproj` files are the source of truth for editor-authored state such as `timelineLanes`, `mediaAudioClip`, `mediaAudioRegions`, and `changeSoundRegions`; canonical metadata is only used for capture-native data like events/cursor/geometry/platform.
- Active preset values are the fallback source for `webcamLayout`, `webcamPosition`, `webcamStyles`, and `isWebcamVisible` when the imported project omits those fields; project-authored values still take precedence when present.
- Backward compatibility defaults if fields are absent:
- `mediaAudioClip = null`
- `mediaAudioRegions = {}`
- `changeSoundRegions = {}`
- `webcamLayout = { mode: 'overlay', side: 'right', webcamWidthPercent: 30 }`
- `swapRegions = {}`

Preset persistence baseline:
- `Preset` stores `styles`, `aspectRatio`, `webcamLayout`, `webcamPosition`, `webcamStyles`, `isWebcamVisible`, `blurDefaults`, and `swapDefaults`.
- `blurDefaults` control only the defaults for newly inserted blur regions: `duration`, `style`, `intensity`, `x`, `y`, `width`, `height`.
- `swapDefaults` control only the defaults for newly inserted swap regions: `duration`, `showDesktopOverlay`, `transition`, `transitionDuration`.
- Editing an existing blur or swap region updates the active preset defaults for that tool; it does not serialize timeline regions into the preset.
- Backward compatibility defaults if preset fields are absent:
- `blurDefaults = { duration: 3, style: 'blur', intensity: 10, x: 0.35, y: 0.35, width: 0.3, height: 0.2 }`
- `swapDefaults = { duration: 15, showDesktopOverlay: true, transition: 'fade', transitionDuration: 0.3 }`

Webcam layout contract baseline:
- `webcamLayout.mode`: `overlay | side-by-side`
- `webcamLayout.side`: `left | right`
- `webcamLayout.webcamWidthPercent`: integer split for webcam share, default `30`
- `webcamStyles.shape`: `circle | square | rectangle | phone`
- `webcamStyles.crop`: normalized `{ top, right, bottom, left }` source crop, default all `0`
- `overlay` keeps current PiP camera behavior, honors position/size/zoom controls, and now supports the vertical `phone` shape.
- `side-by-side` reserves a side column using the split control, keeps webcam shape/border/shadow/flip/crop styling active, and ignores overlay size/position/smart-position controls.
- With frame padding set to `0`, `side-by-side` must not add an extra internal camera inset or gap; camera and desktop areas should be able to reach the frame edges.
- `swap` keeps existing behavior only in `overlay`; in non-overlay layouts the screen is hidden and the webcam expands to the main frame.
- New recordings/projects without serialized webcam layout or visibility must inherit those values from the active preset before falling back to app defaults.
- During editor preview playback, webcam sync currently uses the baseline hard-resync behavior from `Preview.tsx`; do not reintroduce playback-rate nudging or renderer border snapping without fresh visual proof because those changes were rolled back during swap/border flicker investigation.

## 5. UI and Styling Baseline (Tokens and Consistency)

Styling source of truth:
- `src/index.css` for tokens and theme variables.

### 5.1 Theme tokens (exact baseline)

`[data-theme='ocean-blue']` (light):
- `--background: hsl(0 0% 100%)`
- `--foreground: hsl(0 0% 13%)`
- `--card: hsl(0 0% 100%)`
- `--primary: hsl(154 60% 42%)`
- `--primary-foreground: hsl(0 0% 100%)`
- `--muted: hsl(0 0% 97%)`
- `--accent: hsl(0 0% 94%)`
- `--border: hsl(0 0% 86%)`
- `--input: hsl(0 0% 90%)`
- `--ring: hsl(154 60% 42%)`
- `--sidebar: hsl(0 0% 98%)`
- `--sidebar-border: hsl(0 0% 86%)`
- `--timeline-tick: hsl(0 0% 28%)`
- `--speed-accent: hsl(158 78% 52%)`

`[data-theme='ocean-blue'].dark`:
- `--background: hsl(215 16% 16%)`
- `--foreground: hsl(210 20% 98%)`
- `--card: hsl(215 16% 18%)`
- `--primary: hsl(154 60% 50%)`
- `--primary-foreground: hsl(0 0% 100%)`
- `--muted: hsl(215 16% 20%)`
- `--accent: hsl(215 16% 24%)`
- `--border: hsl(215 16% 28%)`
- `--input: hsl(215 16% 26%)`
- `--ring: hsl(154 60% 50%)`
- `--sidebar: hsl(215 16% 17%)`
- `--sidebar-border: hsl(215 16% 28%)`
- `--timeline-tick: hsl(210 18% 76%)`
- `--speed-accent: hsl(154 60% 50%)`

Typography and radius:
- `--font-sans: Inter`
- `--font-heading: Outfit`
- `--radius: 0.24rem` and mapped radii:
- `radius-sm = calc(var(--radius) - 2px)`
- `radius-md = calc(var(--radius) - 1px)`
- `radius-lg = var(--radius)`
- `radius-xl = calc(var(--radius) + 2px)`
- Prefer `rounded-md` / `rounded-lg` for UI controls and surfaces; reserve `rounded-xl`, `rounded-2xl`, and `rounded-full` for semantic exceptions like avatar photos, handles, and tiny indicators.

Icon system baseline:
- Canonical icon entrypoint is `src/components/ui/icons.tsx`, imported via `@icons`.
- Base icon family is Iconoir; do not mix other icon families in desktop renderer code.
- Prefer `IconShell` for framed icon containers and `IconSwitch` for regular/solid state transitions.
- Shared icon hover motion lives in `src/index.css` and must preserve `prefers-reduced-motion` fallback.

### 5.2 Primitive components (required defaults)

Buttons:
- Source: `src/components/ui/button-variants.ts`.
- Variant baseline:
- `default`: `bg-primary` + `text-primary-foreground` + `hover:bg-primary/90`.
- `secondary`: `bg-secondary` + `text-secondary-foreground`.
- `outline`: `border border-input`.
- `ghost`: transparent with accent hover.
- `toolbar`: `bg-card/60`, subtle border/shadow, compact active press effect.
- Size baseline:
- `default`: `h-9 px-4 py-2`
- `sm`: `h-8 px-3`
- `lg`: `h-10 px-8`
- `icon`: `h-9 w-9`

Inputs and selects:
- `Input` (`src/components/ui/input.tsx`): `h-11`, `rounded-lg`, `border border-border`, focus ring `primary/50`.
- `Select` default: `h-11`, `rounded-md`, `border border-border`, dropdown `rounded-md`.
- `Select` minimal: `h-9`, `rounded-lg`, `border-border/40`, lower visual weight.

Slider and switch:
- `Slider` track: `h-2`, rounded-full; handle: `w-[18px] h-[18px] rounded-sm border-primary/40`.
- `Switch`: root `h-6 w-11 rounded-[4px] p-[2px]` with direct background color; thumb `h-4 w-4 rounded-[4px]` with visible shadow in both on/off states.

### 5.3 Layout and dimension baseline (editor)

Global layout:
- Header: `h-12`.
- Side panel container: `w-[28rem]`.
- Side tab rail: `w-[64px]`.
- Side tab icon frame: `w-6 h-6`.
- Header icon chip blocks (settings sections): `w-10 h-10 rounded-lg`.

Timeline geometry (`src/components/editor/Timeline.tsx`):
- `LANE_HEIGHT_PX = 64`
- `LANE_GAP_PX = 8`
- `RULER_HEIGHT_PX = 48`
- `TIMELINE_MIN_VISIBLE_LANES = 2`
- `TIMELINE_MAX_VISIBLE_LANES = 3`
- `LANE_ACTION_STRIP_WIDTH_PX = 28`
- Timeline lane controls use a reserved start gutter in the temporal axis; regions/ticks/playhead must not render into this protected area.
- Timeline empty lane space is selection-only; playhead seeking/dragging belongs to the playhead itself or the sticky temporal ruler above the lanes.
- The temporal ruler above lanes must stay sticky while the timeline scrolls vertically.
- Viewport buffer `+14px` to avoid unintended vertical scroll for 2 lanes.
- Region block visual height: `h-12` for speed/blur/swap/media/change-sound blocks.
- Cut region blocks must remain draggable after selection; selection state must not change the hit target or decouple the draggable element from the visual block.
- Playhead interaction baseline: dragging can start from the full playhead control line (not only the triangle), with `ew-resize` cursor semantics.
- Ruler scrubbing must update continuously from mouse down through window-level mouse move, pause playback while seeking, and clamp the target to the timeline duration.
- Every main-video seek must redraw the canvas after `seeked` and resynchronize webcam, recording audio, computer audio, and media audio before playback resumes.
- While timeline scrubbing is active, coalesce video seek requests with animation-frame scheduling and pause separated audio elements without changing their timestamps; perform one audio sync after scrubbing ends to avoid queued AAC seeks.

Toolbar and preview control sizing:
- `ToolbarButton` default: `h-10 px-4 rounded-lg`.
- `ToolbarButton` icon: `h-10 w-10 rounded-lg`.
- Editing toolbar baseline includes `Change Sound` action alongside `Zoom`, `Trim`, `Speed`, `Blur`, `Swap`.
- Timeline zoom slider wrapper width: `w-24`.
- Aspect ratio select wrapper width: `w-40`.
- Preview duration readout block: `min-w-[130px]`.
- Side-by-side webcam geometry must preserve the selected camera shape/aspect ratio at every frame-padding value. Padding `0` removes the gap only; it must not stretch the camera to the full sidebar height. Keep the webcam anchored to the inner horizontal edge and vertically centered unless its fitted height naturally reaches the top/bottom bounds.
- Recorder floating window presets (`src/lib/recorder-window.ts`): `toolbar 1220x200`, `preview 1220x420`, `settings 1380x820`.
- Recorder toolbar parity rule: Linux and macOS must match the Windows control order and close-button position; Linux-only cursor scale controls belong in `Settings > General`, not in the main recorder toolbar.
- Recorder overflow/click rule: root recorder surfaces must not scroll, webcam preview should only mount while visible, and click-through hover behavior is limited to `win32`/`darwin`; Linux recorder windows stay fully interactive. Opening any recorder toolbar dropdown temporarily disables click-through until the menu closes.
- Recorder interactive-surface invariant: on `win32`/`darwin`, controls, select triggers, and open recorder dropdowns must never leave the recorder in click-through mode while the pointer is still over the toolbar. Switching directly between recorder dropdowns, or clicking the toolbar after a menu closes, must not focus the background window.

### 5.4 Menus, cards, and motion baseline

Collapse blocks:
- `collapse-root`: `rounded-lg`, `border border-border`, `bg-card`.
- Trigger: `px-4 py-3`, hover `bg-accent`.

Context menus:
- Base context panel uses translucent dark style with blur (`bg-zinc-900/60`, rounded-lg, min width 200px).
- Timeline lane action menu overrides to themed card style (`min-w-[184px]`, rounded-xl, `bg-card/95`, `border-border/70`).

Tooltips:
- Default tooltip: `rounded-md`, compact (`px-3 py-1.5`), dark background/light text in light mode, token-aware popover style in dark mode.

Motion:
- Core transitions are short (100-300ms), mostly color/opacity/transform.
- Keep subtle hover/active motion; avoid adding heavy or continuous animations.
- Icon hover motion should stay inside the shared `icon-glyph` / `icon-hover` pattern rather than custom one-off animations.

### 5.5 UI/UX non-negotiable rules

1. Keep all color decisions token-driven from `index.css`; no ad-hoc hex colors in feature code unless justified.
2. Reuse `src/components/ui/*` primitives before introducing one-off controls.
3. Preserve light/dark parity for readability, borders, and focus rings.
4. Maintain existing control density and target sizes (especially `h-8/h-9/h-10/h-11` patterns).
5. Keep side panel tab identity and order stable: `general`, `camera`, `audio`, `media`, `animation`, `cursor`.
6. Product identity remains `RecordSaaS` across desktop surfaces.
7. Do not import icon packages directly in feature files; route desktop icon usage through `@icons`.

## 6. Feature Baseline: v2.4.2 Media Audio Status and Non-Goals

Functional baseline for current roadmap item:
- Media tab exists with categories `Audio`, `Image`, `Video`.
- Audio path supports import, timeline insertion, playback preview, and export integration.
- Windows computer audio is captured and encoded directly by the bundled native WASAPI loopback helper into AAC ADTS. The desktop passes bitrate, sample rate, and initial-skip settings to the helper; it must not pipe helper PCM into live FFmpeg. Linux captures through FFmpeg PulseAudio/PipeWire monitor sources using the configured `AAC` or `MP3` output, and preview/export reuse the same simple full-length source flow.
- One media-audio clip per project baseline.
- Mix includes recording track, optional computer audio, and media audio with lane-aware media/recording region behavior.
- `change-sound` supports local recording-track control (volume, mute, fade).

Out of scope baseline for this item:
- True multi-source audio mixing editor.
- Full multi-track media-audio authoring.
- Advanced media clip trim/resize tooling beyond implemented behavior.
- Full image/video media timeline render/export behavior.

## 7. Desktop/API Integration Touchpoints (Only What Impacts Desktop)

Desktop-visible integration points:
- Auth/session IPC channels in `electron/main/ipc/handlers/auth.ts` and `electron/main/ipc/index.ts`.
- External browser and shell actions in `electron/main/ipc/handlers/shell.ts`.

When backend/API changes can affect desktop:
- Login/session token shape or auth callback behavior.
- Billing/plan or entitlement checks if reflected in desktop gates.
- URL and environment contract changes used by auth or external redirects.

Desktop-safe integration rule:
- Treat `recordsaas-api` as an external dependency boundary.
- For desktop tasks, only pull API details necessary to preserve desktop behavior and contracts.

Release CI baseline:
- `.github/workflows/release.yml` is the source of truth for desktop release automation.
- Windows release builds use `windows-2022`; `global-mouse-events` depends on `node-gyp@10`, which supports Visual Studio 2022 but not the Visual Studio 18 image currently exposed by `windows-latest`.
- Semantic-release creates the GitHub Release/tag first; the build matrix then compiles per OS and uploads public release assets to that existing GitHub Release.
- `scripts/ensure-binaries.mjs` must resolve FFmpeg release assets through direct GitHub release download URLs by default, with authenticated GitHub API lookup only as fallback so CI is not blocked by anonymous API rate limits.
- `scripts/ensure-binaries.mjs` must only validate or download the prebuilt Windows system-audio helper. Desktop setup must never run `dotnet publish` or compile native helper source.
- Public desktop assets are limited to `RecordSaaSSetup-mac-v<version>.zip`, `RecordSaaSSetup-linux-v<version>.zip`, and `RecordSaaSSetup-windows-v<version>.exe`.
- Other packaged outputs (`dmg`, `AppImage`, `deb`, `rpm`) may still be generated during build, but they are not the canonical public release artifacts unless the workflow is intentionally changed.

## 8. LLM Heatmap + Workflow (Balanced Rigor)

### 8.1 Heatmap (change risk and attention depth)

- H5 (critical contracts):
- `src/types/index.ts`
- `src/store/slices/projectSlice.ts`
- `src/store/slices/timelineSlice.ts`
- `src/store/slices/presetSlice.ts`
- `electron/preload.ts`
- `electron/main/ipc/index.ts`
- `electron/main/ipc/handlers/export.ts`
- `electron/main/ipc/handlers/file-system.ts`

- H4 (high impact behavior/UI logic):
- `src/components/editor/Timeline.tsx`
- `src/components/editor/Preview.tsx`
- `src/components/editor/RegionSettingsPanel.tsx`
- `src/components/editor/sidepanel/MediaAssetsPanel.tsx`
- `src/hooks/useTimelineInteraction.ts`
- `src/hooks/useExportProcess.ts`

- H3 (feature wiring and page-level flow):
- `src/components/editor/SidePanel.tsx`
- `src/pages/EditorPage.tsx`
- `src/pages/RecorderPage.tsx`
- `src/components/editor/ExportModal.tsx`

- H2 (style and presentation tuning):
- `src/index.css`
- `src/components/editor/sidepanel/*.tsx` (visual-only changes)

- H1 (low-risk text/docs):
- Non-runtime copy and documentation.

### 8.2 Workflow checkpoints: Search -> Analysis -> Refinement -> Coding -> Validation

1. Search
- Classify request domain first (UI, timeline, media, IPC, export, auth).
- Read minimum files from Section 3 for that domain.
- Avoid whole-repo scans unless ambiguity remains.

2. Analysis
- Confirm current behavior from types + slice + UI/IPC edges.
- Identify invariants that must stay true (compatibility, lane precedence, runtime copy policy).

3. Refinement
- Narrow to smallest safe edit set.
- Define exact interfaces/contracts touched.
- Pre-plan validation before editing.

4. Coding
- Apply minimal coherent edits across boundaries.
- Keep type/store/UI/IPC updates synchronized.
- Avoid opportunistic refactors unrelated to request.

5. Validation
- Run targeted checks for edited domain.
- Verify compatibility defaults and regression-sensitive flows.
- Confirm no contract drift between renderer types and preload/main IPC.
- For recorder toolbar/window edits, explicitly validate dropdown direction, long-label truncation, switching between dropdowns without extra mouse movement, toolbar clicks outside an open menu, and hover click-through recovery only after the pointer leaves interactive surfaces.

### 8.3 Token-efficiency retrieval protocol

Read-minimum-first rings:
- Ring 1: one entry file + one contract file (fast triage).
- Ring 2: one slice/handler + one UI component (behavior confirmation).
- Ring 3: related hook and adjacent handlers only if still ambiguous.

Escalation path:
- If ambiguity remains after Ring 2, expand to Ring 3.
- If still unresolved, inspect neighboring modules in same subsystem.
- Do not jump to global grep of entire repository unless contract ownership is unknown.

## 9. Task Routing Matrix (Intent -> Minimum Files -> Risk -> Validation)

| Request intent | Minimum files to inspect first | Risk | Expected validation |
| --- | --- | --- | --- |
| UI tweak in side panel/tokens | `src/index.css`, `src/components/editor/SidePanel.tsx`, relevant `src/components/editor/sidepanel/*.tsx` | Medium | Visual check in light/dark + ensure tab flow unchanged |
| Media-audio insertion/region behavior bug | `src/types/index.ts`, `src/store/slices/timelineSlice.ts`, `src/components/editor/timeline/MediaAudioRegionBlock.tsx`, `src/components/editor/sidepanel/MediaAssetsPanel.tsx` | High | Region creation/move behavior + playback sync |
| IPC media import issue | `electron/main/ipc/index.ts`, `electron/main/ipc/handlers/media.ts`, `electron/preload.ts`, `src/components/editor/sidepanel/MediaAssetsPanel.tsx` | High | Import dialog path + runtime copy rule + renderer response handling |
| Export mix regression (recording + media) | `src/hooks/useExportProcess.ts`, `src/store/slices/projectSlice.ts`, `electron/main/ipc/handlers/export.ts`, `src/components/editor/ExportModal.tsx` | Critical | `npm run verify:export-startup`; progress appears before heavy work; cancel works during auth/audio/render/finalize; output has expected mix and region effects |
| `.rsproj` load/save compatibility issue | `src/store/slices/projectSlice.ts`, `src/store/slices/presetSlice.ts`, `electron/main/ipc/handlers/file-system.ts`, `src/types/index.ts` | Critical | Load legacy project/preset data with missing fields and confirm safe defaults plus preset fallback precedence |
| Auth/session desktop behavior issue | `electron/main/ipc/handlers/auth.ts`, `electron/main/ipc/index.ts`, `electron/preload.ts` | High | Session fetch/login/logout still works through IPC boundary |
| Recorder toolbar/window interaction bug | `src/pages/RecorderPage.tsx`, `src/lib/recorder-window.ts`, `electron/main/windows/recorder-window.ts` | High | Dropdowns open downward, long labels truncate, switching between recorder dropdowns does not focus the background window, toolbar clicks outside an open menu stay on the recorder, and hover click-through still restores after leaving the toolbar |
| Screen capture/encoder selection issue | `electron/main/features/windows-screen-capture.ts`, `electron/main/features/screen-encoder.ts`, `electron/main/features/recording-manager.ts`, `src/components/settings/PerformanceTab.tsx`, `src/pages/RecorderPage.tsx` | Critical | Probe selected encoder, verify Automatic/manual/Generic warnings, record secondary monitors with mixed DPI, confirm cursor appears once, and compare hardware versus Generic CPU usage |
| Recorder-to-editor handoff issue | `src/pages/RecorderPage.tsx`, `electron/main/ipc/handlers/recording.ts`, `src/pages/EditorPage.tsx` | High | Open/import flow starts editor with correct payload |
| Release CI / artifact publishing change | `.github/workflows/release.yml`, `.releaserc.json`, `package.json` | High | Confirm release tag/version handoff, public asset names, and GitHub Release upload behavior |

Workflow simulation checkpoints:
- Prompt A (UI tweak): must route to H2/H3 files first, not H5 export/serialization files.
- Prompt B (media-audio fix): must route to H4/H5 timeline+types contracts first.
- Prompt C (IPC/export change): must route to H5 IPC bridge and export handlers first.

## 10. Safe-Change Rules (Compatibility, Undo/Redo, IPC, Serialization)

1. Keep renderer/main boundaries strict.
- Renderer never bypasses preload for privileged operations.
- Any new IPC capability requires synchronized updates in `ipc/index.ts`, handler module, preload API, and renderer usage.

2. Preserve backward compatibility in `.rsproj`.
- Missing fields must resolve to safe defaults.
- Never assume new fields exist in imported legacy projects.

3. Protect undo/redo semantics.
- Only intended visual/timeline state belongs to temporal history.
- Do not add operational or transient runtime state to undo history.

4. Respect media asset ownership policy.
- Runtime session uses copied assets in app-owned path.
- Do not treat original user source files as session-managed files.

5. Preserve lane precedence and region invariants.
- Overlap resolution follows lane ordering rules.
- Region edits must keep duration/start bounds valid and consistent.

6. Keep scope discipline.
- Implement request-specific changes only.
- Do not fold unrelated refactors into behavioral fixes.

## Source-to-Section Crosswalk (Completeness)

Historical source docs listed below were consolidated and then removed from the repository.

| Historical source document (removed after consolidation) | Covered in this file |
| --- | --- |
| `recordsaas/docs/README.md` | Sections 1, 2, 3, 8 |
| `recordsaas/docs/implementation/desktop-baseline.md` | Sections 2, 3, 4, 10 |
| `recordsaas/docs/implementation/ui-baseline.md` | Section 5 |
| `recordsaas/docs/implementation/media-assets-contract.md` | Sections 4, 6, 10 |
| `recordsaas/docs/roadmap/v2.4.2-item-1-audio-media.md` | Section 6, Section 9 simulation checkpoints |
| `recordsaas/README.md` | Section 1 and brand/product baseline in Section 5 |
| `recordsaas-api/agent.md` (desktop-relevant only) | Section 7 |

## Maintenance Rule

This file is mandatory maintenance scope for both humans and LLMs.

### Mandatory update triggers

Update `AGENTS.MD` in the same PR/commit when any of the following changes:
- Architecture boundaries, ownership, or key file locations.
- IPC channels, preload API surface, export/import payloads, or serialization behavior.
- Store contracts, timeline region types, media-audio rules, or compatibility defaults.
- UI/UX design-system defaults (tokens, sizes, spacing, border/radius patterns, menu patterns).
- Task routing matrix or heatmap priorities.

If `agent.md` exists as a secondary guide, keep it aligned in the same change set.

### Required maintenance checklist

1. Update the affected section(s) with the new canonical rule, not a temporary note.
2. Update Section 3 (code map) if file ownership/entry points changed.
3. Update Section 8 and Section 9 if risk, workflow, or routing changed.
4. Keep Section 5 aligned with current token and component defaults.
5. Keep this guide free of duplicate/conflicting rules.

### Completion policy

A feature/fix that changes behavior is incomplete if `AGENTS.MD` is stale.
Treat AGENTS documentation update as a definition-of-done item, not optional follow-up work.
