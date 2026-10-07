# Camber — Park Editor Spec

Oct 5, 2026 · Source: [https://claude.ai/artifact/EPvX8ow3JGuu2f2owMkf2A](https://claude.ai/artifact/EPvX8ow3JGuu2f2owMkf2A)

## Overview

An in-game park editor for Camber: place features, shape their takeoff, table, height offset and landing, see flight arcs and landing impact live, and drop in to ride-test. It runs inside the game, so the editor and the game share the same generators and physics.

**Prerequisite: the shared building blocks come first.** The editor is a thin layer over parametric features. If features are hand-coded, every new one needs its own editor UI; if they're compositions of the shared blocks (Feature Catalogue Spec), one parameter panel and one profile editor work for all of them. Required before editor work starts:

1. Shared blocks implemented: Run-in, Takeoff, Table, Landing, Ridge, Wall, Jib, Mound.
2. Existing features refactored into block compositions, behaviour unchanged.
3. Layout JSON loads and regenerates a park in under ~1 s.
4. A single feature regenerates in under ~50 ms, so dragging a handle feels live.
5. EFH calculation available per landing point (Hip Jump Spec).

**Scope:** features first. The editor exposes whole features with their parameters (kicker, hip, wedge…). Raw block editing comes later, for unusual builds.

## Modes and core loop

Two modes, one key to switch (Tab / gamepad Select):

- **Edit:** rider frozen and hidden, free-fly camera, editor UI visible, physics paused.
- **Ride:** normal game. Editor UI hidden; overlays optional.

The core loop is shape → check → ride → adjust:

1. Select or place a feature.
2. Shape it (gizmo for position, panels for shape).
3. Check the live arcs and impact colours.
4. **Ride from here:** drop the rider at the start of the selected feature's run-in at its design speed.
5. **Back to edit:** return to Edit with the camera where it was and the same feature selected.

Step 4 to 5 must take under a second. Fast iteration is the whole point of building the editor inside the game.

## Placement and transform

- **Palette:** list of features from the catalogue, each with size presets (S–XL). Pick one, then click the terrain to place it.
- **Snapping on placement:** the feature sits on the terrain surface and its takeoff heading aligns to the local fall line. Hold Alt to place without alignment.
- **Gizmo:** Three.js `TransformControls`, limited to what makes sense on a slope: move along the surface (X/Z, height follows terrain) and rotate around the vertical axis. No free pitch/roll; the slope sets those.
- **Height offset:** not a gizmo axis. It's a parameter (step-up/step-down) so the landing re-solves when it changes.
- **Selection:** click to select, Shift-click to multi-select, Delete to remove, Ctrl/Cmd-D to duplicate, M to mirror (left hip ↔ right hip).
- **Parameter panel:** Tweakpane (or lil-gui) listing the selected feature's parameters, grouped by block: Takeoff, Table, Landing, Jib. Changes regenerate the feature live.
- **Locks:** derived values (landing profile, landing length, rail start height) are shown read-only, with their source (e.g. "from target EFH"). Users change the inputs, never the derived shape directly.

## Profile editor

The main design surface: a 2D side view of the selected feature along its takeoff heading, docked at the bottom of the screen. Shape gets decided here; the 3D view is for placement.

_Diagram not exported (profile editor mockup); see the [source doc](https://claude.ai/artifact/EPvX8ow3JGuu2f2owMkf2A)._

- **Handles** (drag in the 2D view): lip angle (rotate at the lip), lip height, straight lip length, table length (horizontal at the knuckle), step up or down (vertical at the landing start), transition radius.
- **Sliders:** design speed range and target EFH. The landing re-solves on every change; it has no handles of its own.
- **Arcs:** flight paths at min, mid and max design speed, redrawn live.
- **Impact colour:** the surface is coloured by EFH at each landing point: green up to 1.0 m, amber up to 1.5 m, red above. Flat table and knuckle landings show red by design.
- **Hips and angled features:** a heading selector picks which section to show (straight over the table, or one of the hip headings), plus a small cross-section view for side pitch.
- **Numeric entry:** click any handle to type an exact value.
- **Constraints:** handles clamp to valid ranges (lip angle 10 to 35 degrees, table 0 to 25 m, step up or down 6 m). Out-of-range shapes are never generated.

## Feedback overlays and validation

Toggles in the editor toolbar; all use data the game already computes.

- **Arcs in 3D:** the same min/mid/max arcs drawn on the feature in the 3D view; for hips, a fan across the aim range.
- **Impact heatmap:** landing surfaces tinted by EFH in 3D, matching the profile editor colours.
- **Speed check:** expected speed arriving at each feature, from the speed map, compared with the feature's design speed range. Too slow or too fast shows a warning badge on the feature.
- **Connection graph:** lines between features that connect (from the Terrain spec). Shows which transfers a placement opens or breaks.
- **Slope and surface views:** slope-band heatmap and surface type (park, powder).

**Validation (non-blocking):** each feature shows a status dot.

- Green: reachable at design speed, landings within target EFH, no overlaps.
- Amber: speed mismatch, impact above target on part of the landing, or tight clearance.
- Red: overlapping colliders, unreachable, or landing below the parent terrain.

A park can be saved with warnings; ride-test is how you decide.

## Data, save, undo

- **One format:** the editor reads and writes the same layout JSON as the procedural generator (Terrain spec). A generated park can be opened, hand-tuned and saved.
- **Feature record:** type, preset, position on terrain, yaw, and only the parameters that differ from the preset. Derived values (landing profile, rail start) are never stored; they regenerate on load.
- **Undo/redo:** a stack of layout snapshots (layouts are small). Ctrl/Cmd-Z and Shift-Ctrl/Cmd-Z. Every drag commits one step on release, not per frame.
- **Autosave:** to IndexedDB in the player's own browser every 30 s and on mode switch, keyed by park name. Anyone testing the game keeps their edits between sessions on that device, nothing more. A "Reset to default park" button discards the cache.
- **Export/import:** download and upload the JSON file. This is how parks get published for now: export, commit the JSON to the repo (e.g. `/parks/<name>.json`), deploy. The game loads repo parks as the defaults; a local cached edit overrides its default until reset. If a repo park changes after a player cached an edit, show a notice and offer to reset.
- **Locked seed terrain:** the base terrain comes from the seed and terrain parameters; the editor places features on it but doesn't sculpt terrain (see Out of scope).

**Out of scope for v1:** terrain sculpting, multi-user editing, raw block editing, and saving parks to a server or sharing them in-game. Server saving comes later; the JSON format won't change when it does.

## Controls and UI layout

Mouse and keyboard first; gamepad support only for camera and ride-test.

**Layout:**

- Left: palette (features + presets).
- Right: parameter panel for the selection.
- Bottom: profile editor (collapsible).
- Top: toolbar with mode, overlays, undo/redo, save/export, Ride from here.
- Centre: 3D view.

| Action | Mouse / keyboard | Gamepad |
| --- | --- | --- |
| Toggle edit / ride | Tab | Select |
| Fly camera | WASD + right-drag, Q/E down/up, Shift fast | Sticks, bumpers up/down |
| Place / select | Left click | — |
| Move / rotate | Gizmo, or G / R | — |
| Duplicate, mirror, delete | Ctrl/Cmd-D, M, Delete | — |
| Frame selection | F | — |
| Ride from here | Enter | A |
| Undo / redo | Ctrl/Cmd-Z, Shift-Ctrl/Cmd-Z | — |

## Build order and Claude Code prompt

**Phase 0, prerequisites (Feature Catalogue Spec):** shared blocks, existing features refactored, fast single-feature regeneration, EFH per landing point.

**Phase 1, editor core:**

1. Edit/ride mode toggle with free-fly camera.
2. Palette, placement with terrain snap and fall-line alignment.
3. Gizmo (surface move + yaw), selection, duplicate, mirror, delete.
4. Parameter panel with live regeneration.
5. Ride from here / back to edit.
6. Save/load layout JSON, autosave, undo/redo.

**Phase 2, design tools:**

7. Profile editor with handles, sliders, arcs and impact colour.
8. 3D overlays: arcs, impact heatmap, speed check.
9. Validation status dots.
10. Connection graph overlay.

**Prompt (per step):**

```
Read docs/park-editor-spec.md, plus docs/feature-catalogue-spec.md, docs/hip-jump-spec.md and docs/terrain-spec.md for context.

Implement step <STEP> of the editor build order. Phase 0 must be complete first; if it isn't, stop and tell me what's missing.

Rules:
- The editor is a layer over the existing feature generators. Never duplicate generation logic in the editor.
- The editor only changes feature parameters; derived shapes (landings, rail starts) always regenerate.
- One layout JSON format shared with the procedural generator.
- Editor UI with Tweakpane (or lil-gui) for panels; the profile editor as a 2D canvas. No UI framework.
- Editor code lives in its own folder and is excluded from the game bundle until opened (dynamic import).
- Minimal dependencies.

Start in plan mode: list files and how the editor hooks into the existing generators. After implementing, tell me what to test.
```
