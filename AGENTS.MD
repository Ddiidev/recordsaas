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

Hard scope boundaries for current cycle:
- Desktop-first guidance (not landing-page-first).
- API context included only where desktop behavior depends on it.
- No assumption of multi-track media audio authoring beyond current implemented contracts.

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

Project/runtime flow:
1. Session assets are created/copied into runtime storage (`~/.recordsaas`).
2. Renderer loads project payload and hydrates store state.
3. Editing and preview happen entirely in renderer state.
4. Export payload is sent to main process for final processing.
5. Session cleanup is triggered on editor closure per runtime policy.

## 3. Source-of-Truth Code Map (Where to Read First)

### 3.1 Entry and app flow
- `src/App.tsx`
- `src/pages/RecorderPage.tsx`
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

### 3.6 Types and contracts
- Canonical app types: `src/types/index.ts`

## 4. State and Contract Baseline (Store, Regions, Serialization)

Store composition:
- Global store uses Zustand + Immer + Zundo in `src/store/editorStore.ts`.
- Undo/redo history is intentionally partialized to visual/timeline state; operational state must not pollute history.

Media-audio contract state:
- `mediaAudioClip: MediaAudioClip | null`
- `mediaAudioRegions: Record<string, MediaAudioRegion>`
- `changeSoundRegions: Record<string, ChangeSoundRegion>`

Canonical contract fields:
- `MediaAudioClip`: `id`, `path` (runtime absolute), `url` (`media://...`), `name`, `duration`, `startTime`.
- `MediaAudioRegion`: `id`, `type='media-audio'`, `laneId`, `startTime`, `duration`, `sourceStart`, `isMuted`, `volume`, `fadeInDuration`, `fadeOutDuration`, `zIndex`.
- `ChangeSoundRegion`: `id`, `type='change-sound'`, `laneId`, `startTime`, `duration`, `sourceKey='recording-mic'`, `isMuted`, `volume`, `fadeInDuration`, `fadeOutDuration`, `zIndex`.

Core business rules:
1. Media audio playback follows `mediaAudioRegions` and is independent from recording-mic source.
2. `change-sound` regions affect recording audio only.
3. Lane precedence applies when overlaps occur (upper lane wins).
4. Region-level mute/volume/fade are enforced on applicable tracks.
5. Final mix includes recording + media when both are present.
6. Image/video media categories can remain placeholder if no render/export behavior is implemented.

IPC contract baseline (media import):
- Channel: `media:import-audio`
- Return union:
- `{ canceled: true }`
- `{ canceled: false, asset: { path: string, name: string } }`
- Mandatory rule: selected media is copied into runtime storage (`~/.recordsaas`); original user path must not become session ownership.

`.rsproj` compatibility baseline:
- Serialized fields of interest include `mediaAudioClip`, `mediaAudioRegions`, `changeSoundRegions`.
- Serialized camera/layout fields of interest include `webcamLayout`, `webcamPosition`, `webcamStyles`, `isWebcamVisible`, `swapRegions`.
- Imported `.rsproj` files are the source of truth for editor-authored state such as `timelineLanes`, `mediaAudioClip`, `mediaAudioRegions`, and `changeSoundRegions`; canonical metadata is only used for capture-native data like events/cursor/geometry/platform.
- Backward compatibility defaults if fields are absent:
- `mediaAudioClip = null`
- `mediaAudioRegions = {}`
- `changeSoundRegions = {}`
- `webcamLayout = { mode: 'overlay', side: 'right', webcamWidthPercent: 30 }`
- `swapRegions = {}`

Webcam layout contract baseline:
- `webcamLayout.mode`: `overlay | side-by-side`
- `webcamLayout.side`: `left | right`
- `webcamLayout.webcamWidthPercent`: integer split for webcam share, default `30`
- `webcamStyles.shape`: `circle | square | rectangle | phone`
- `webcamStyles.crop`: normalized `{ top, right, bottom, left }` source crop, default all `0`
- `overlay` keeps current PiP camera behavior, honors position/size/zoom controls, and now supports the vertical `phone` shape.
- `side-by-side` reserves a side column using the split control, keeps webcam shape/border/shadow/flip/crop styling active, and ignores overlay size/position/smart-position controls.
- `swap` keeps existing behavior only in `overlay`; in non-overlay layouts the screen is hidden and the webcam expands to the main frame.

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
- `Switch`: root `h-6 w-11 rounded-md`; thumb `h-5 w-5 rounded-[4px]`.

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
- Viewport buffer `+14px` to avoid unintended vertical scroll for 2 lanes.
- Region block visual height: `h-12` for speed/blur/swap/media/change-sound blocks.
- Playhead interaction baseline: dragging can start from the full playhead control line (not only the triangle), with `ew-resize` cursor semantics.

Toolbar and preview control sizing:
- `ToolbarButton` default: `h-10 px-4 rounded-lg`.
- `ToolbarButton` icon: `h-10 w-10 rounded-lg`.
- Editing toolbar baseline includes `Change Sound` action alongside `Zoom`, `Trim`, `Speed`, `Blur`, `Swap`.
- Timeline zoom slider wrapper width: `w-24`.
- Aspect ratio select wrapper width: `w-40`.
- Preview duration readout block: `min-w-[130px]`.

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
- One media-audio clip per project baseline.
- Mix includes recording track plus media audio with lane-aware region behavior.
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

## 8. LLM Heatmap + Workflow (Balanced Rigor)

### 8.1 Heatmap (change risk and attention depth)

- H5 (critical contracts):
- `src/types/index.ts`
- `src/store/slices/projectSlice.ts`
- `src/store/slices/timelineSlice.ts`
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
| Export mix regression (recording + media) | `src/hooks/useExportProcess.ts`, `src/store/slices/projectSlice.ts`, `electron/main/ipc/handlers/export.ts`, `src/components/editor/ExportModal.tsx` | Critical | Export output has expected mix and region effects |
| `.rsproj` load/save compatibility issue | `src/store/slices/projectSlice.ts`, `electron/main/ipc/handlers/file-system.ts`, `src/types/index.ts` | Critical | Load legacy project with missing fields and confirm safe defaults |
| Auth/session desktop behavior issue | `electron/main/ipc/handlers/auth.ts`, `electron/main/ipc/index.ts`, `electron/preload.ts` | High | Session fetch/login/logout still works through IPC boundary |
| Recorder-to-editor handoff issue | `src/pages/RecorderPage.tsx`, `electron/main/ipc/handlers/recording.ts`, `src/pages/EditorPage.tsx` | High | Open/import flow starts editor with correct payload |

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
