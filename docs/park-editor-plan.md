# Park editor — spec against the code

2026-10-05. Source: Park Editor Spec (`docs/park-editor-spec.md`), checked against
`claude/project-analysis-plan-shg4g6` (PR #23). This keeps the source's core loop (shape →
check → ride → adjust) and changes what the code makes simpler or what CLAUDE.md rules out.

## UI chrome

The editor is CLAUDE.md's third agreed exception to "no UI chrome" (added 2026-10-05):
`?edit=1`, dynamic import, edit mode only, Tweakpane panels, one 2D canvas, a gizmo.

## What already exists

| Spec prerequisite or tool | Status |
|---|---|
| One layout format for hand-built and generated parks | Done: `src/park/layout.ts`, `parks.ts` |
| Features as data, regenerated on load | Done: `FeatureSpec.cfg` + `meta` |
| Kicker landings solved from flight | Done: `designKicker` (`src/gen/kit.ts`) |
| Arcs, speed map, slope heatmap, lines + footprints overlays | Done: `render/debugOverlays.ts`, park folder |
| Overview camera, `&at=x,z` spawn | Done |
| Connection graph | Not started (generator step 7) |
| Trajectory preview | Not started (generator step 8) |
| Feature regenerates in < 50 ms | **No.** The terrain mesh is one 1.44M-triangle build. |
| Shared building blocks | **Dropped.** Per-feature configs plus kit functions already give "features are data". |
| Impact-height (EFH) per landing point | **Dropped.** Use the game's impact test (m/s), as everywhere. |

## Prerequisites (phase 0)

1. **Kit functions split into inputs and solve.** Each `design*` takes an rng today, and draws
   values inside. Split each into `draw*(rng) → inputs` and `solve*(inputs) → FeatureSpec`, and
   store the inputs in `meta.design`. The editor edits `meta.design` and re-solves. One file,
   `kit.ts`.
2. **Tiled terrain mesh.** The mesh is built in 32 × 32 m tiles. An edit rebuilds only the
   tiles under the changed feature's footprint (old and new). Target: < 50 ms per edit.
   Render-only.
3. **`meta.group`** (shared with the obstacles spec): composites move as one.

## Two kinds of feature in the editor

- **Designed:** `meta.design` present (everything the generator makes, and anything placed from
  the palette). The panel shows design inputs (size, speed range, drop, yaw, height ranges).
  Derived shape (landing, knuckle, rail start) is read-only, labelled "solved from flight".
- **Hand:** no `meta.design` (home, slopestyle and Sochi features today). The panel shows the
  raw config fields (`KickerConfig` etc.). Converting a hand feature to designed is a later
  nicety, not v1.

## Modes

- **Edit:** sim paused, rider hidden, free-fly camera, editor panels visible.
- **Ride:** the normal game; editor panels hidden; overlays as the park folder sets them.
- **Toggle:** Tab, or gamepad Select if free. Riding keys (WASD, QE, R, Space, Shift, arrows)
  are only read in ride mode, so edit-mode keys don't collide.
- **Ride from here** (Enter / A): rebuild the terrain from the layout and spawn
  `GEN.clear.runIn` (20 m) uphill of the selected feature's lip on its axis, at its design
  mid speed. **Back to edit** returns to the same camera and selection. Round trip < 1 s.
- **Takes** keep the terrain they were ridden on, as now, so a ride-test can be saved and
  replayed after the park changes.

## Placement and transform

- **Palette:** a Tweakpane folder of buttons, one per kit obstacle × size. No custom side panel.
  Pick one, then click the terrain: placed at the click and aligned to the local fall line;
  Alt places it unaligned.
- **Gizmo:** `TransformControls` from `three/examples/jsm` (part of Three.js, no new
  dependency), restricted to moving on the surface (X/Z) and yaw. G / R switch move and
  rotate, F frames the selection.
- **Selection:** click picks the feature whose footprint holds the hit point. Shift-click adds;
  Delete removes; Ctrl/Cmd-D duplicates; M mirrors (left hip ↔ right hip, `side` or `yaw`
  sign). Groups select as one.
- **Clamps:** every input clamps to its `GEN` range. Out-of-range shapes are never generated.
  Heights and drops are inputs, never gizmo axes, so landings re-solve.

## Profile editor (phase 2)

A 2D canvas docked at the bottom, a side section along the selected feature's axis.

- **Drawn by sampling `terrain.sample` along the axis.** It works for every feature with no
  per-feature drawing code.
- **Handles:** the feature's design inputs that have a place on the section. For a kicker: lip
  angle at the lip, lip height, table length, step up/down at the landing start. For other
  types, its inputs. The landing has no handles; it re-solves on release.
- **Sliders** (Tweakpane): speed range, pop range for the arcs.
- **Arcs:** `gen/flight.ts` `fly()` at min / mid / max speed with mid pop, the same airs the
  kit checks.
- **Impact colour on the section:** green below `land.impactSketchy` (13 m/s), amber up to
  `land.impactBail` (17 m/s), red above. Read from params, so it follows tuning.
- **Hips and turned features:** a heading picker sets the section's direction (along the
  table, or an aim heading).
- **Numeric entry:** click a handle to type a value.

## Overlays and validation (phase 2)

- **Reuse the park folder's overlays:** slope, speed, arcs, lines/footprints. Add an **impact**
  overlay, landing surfaces tinted by the colours above, from the kit's arc checks.
- **Validation dot** over each feature, edit mode only:

  | Dot | Condition |
  |---|---|
  | Red | Footprint overlaps another (`footprint.ts`); slowest designed air bails; or speed-map arrival < design min |
  | Amber | Arrival > design max + `lines.brakeMargin`'s worth; or any designed air sketchy |
  | Green | Otherwise |

  A park saves with warnings; ride-testing decides.
- **Connection graph:** once generator step 7 exists, drawn as lines between linked features
  (`Layout.links`).

## Data, save, undo

- **Format:** the editor reads and writes `Layout` (`version: 1`) and nothing else.
- **Editing a generated park forks it** into a named layout; the seed stays in `layout.seed`
  for reference.
- **Undo/redo:** a stack of layout snapshots. A drag commits one step on release.
  Ctrl/Cmd-Z, Shift-Ctrl/Cmd-Z.
- **Autosave:** IndexedDB in the player's browser, every 30 s and on mode switch, keyed by park
  name. "Reset to default" drops the local copy.
- **Publish:** export the JSON, commit it to `parks/<name>.json`, deploy. `parks.ts` loads repo
  parks as the defaults; a local copy overrides until reset. If the repo version changed since
  the copy was made, show a notice in edit mode.
- **Out of scope for v1:** terrain sculpting (the ground stays seed + generator config),
  raw block editing, multi-user editing, server saving.

## Invariants

- The editor never imports from or writes into `src/sim/**` state. It edits the layout, and
  the terrain is rebuilt from it with `createSlope`, as on load.
- No generation logic in the editor: every shape comes from `kit.ts` solve functions or the
  terrain configs.
- No new dependencies.

## Build order

**Phase 0:** kit split + `meta.design`, tiled terrain mesh, `meta.group`.

**Phase 1, core:**
1. Edit/ride toggle, free-fly camera.
2. Palette and placement with fall-line alignment.
3. Gizmo (surface move + yaw), selection, duplicate, mirror, delete.
4. Parameter panel with live re-solve.
5. Ride from here / back to edit.
6. Export/import, autosave, undo/redo.

**Phase 2, design tools:**
7. Profile editor.
8. Impact overlay and validation dots.
9. Connection graph overlay (after generator step 7).

## Done when

A new line can be built in the editor in under 10 minutes, ridden from each feature, saved to
`parks/<name>.json`, and loaded by `?park=<name>` on another machine with the same frames for
the same take. This is milestone 7's gate, met through the editor.
