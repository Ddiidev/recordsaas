---
name: expert-border-designer
description: Expert UI border and radius review for components with nested shapes. Use when Codex must fix or design controls with inner/outer corners, switch/thumb handles, sliders, progress bars, buttons, cards, borders, shadows, padding/inset geometry, or visual mismatches between active and inactive states.
---

# Expert Border Designer

Use this skill to make UI component geometry feel intentional: outer border, inner fill, handle/thumb, shadow, and state transitions must look like one system.

## Workflow

1. Inspect existing primitives before choosing values.
2. Identify every visible layer: outer frame, colored fill, inner track, handle/thumb, border, padding, shadow, focus ring.
3. Match the repo radius scale. Prefer existing tokens/classes (`rounded-sm`, `rounded-md`, `--radius`) unless exact pixel parity is required.
4. Keep handle visuals identical across states. Active/inactive should move the handle or change container color; handle size, radius, border, and shadow should stay the same.
5. Validate with the real component state and screenshot context, especially high-zoom screenshots where 1-2px errors are obvious.

## Geometry Rules

- Do not guess radius values. Compare buttons, inputs, sliders, progress bars, and nearby controls first.
- Treat outer and inner corners separately. A container can have correct external radius while its internal colored area still looks square.
- If the colored background should fill the full switch/track, keep that background on the container. Do not add an inner track layer unless the design really needs a separate inset surface.
- If using an inner layer, compute its radius from the visible inset. Confirm it does not make the colored area look smaller, disconnected, or more rounded than the handle.
- Avoid `overflow-hidden` when it clips handle shadow. Use it only when clipping is the intended fix and shadow remains acceptable.
- For switch-like controls, keep the thumb inside the container with real internal spacing, not by oversizing the thumb or relying on overflow.
- Prefer one radius language per control. If the request says the handle and container must match in pixels, use explicit matching values such as `rounded-[4px]` on both.

## Switch Checklist

- Container keeps current background colors for on/off/hover unless user asks for color changes.
- Thumb has fixed size in both states.
- Thumb has visible shadow in both states.
- Thumb radius matches the intended system radius.
- Container external and internal corners use the same visual radius language as the thumb.
- Active state changes only thumb transform and container color.
- Translation math keeps the thumb inside the container at both ends.

## Failure Patterns

- Bigger active thumb: state-specific classes changed size, scale, border, or shadow.
- Square inner corner: background, border, padding, or an inset layer is drawing a rectangle inside a rounded shell.
- Shadow disappears when active: state color/overflow clips or hides the thumb shadow.
- Too rounded: arbitrary pixel radius or `rounded-full`/large radius was used instead of the app scale.
- Worse after adding an inner track: the component did not need a separate track; restore direct background and fix radius/padding instead.

## Validation

- Check light and dark themes when available.
- Check active, inactive, hover, focus, and disabled states.
- Use high-zoom screenshots for visual bugs around 1-4px.
- Run the repo's normal type/lint checks after code edits.
