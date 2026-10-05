# Camber — Feature Catalogue Spec

Oct 5, 2026 · Source: [https://claude.ai/artifact/Q8Rip5fhu6yRgWcuBTFjeX](https://claude.ai/artifact/Q8Rip5fhu6yRgWcuBTFjeX)

## Overview

Every park and slopestyle feature Camber may need, specified as a combination of a few shared building blocks. A new feature should be new parameters, not a new generator. Deep specs live in separate docs (Hip Jump Spec, Terrain & Level Design Spec, Landing & Feel Spec); this doc is the catalogue that ties them together.

**How to read the tables:** each row gives the feature, the blocks it's built from, its key parameters, and its status: **Built** (in the kit), **Spec'd** (has a blueprint or spec), **P1** (first procedural pass), **P2** (later), **P3** (nice to have).

**Corrections to earlier notes:**

- Hips are 90° by default (45–60° for mellow ones), not 30–60°.
- The earlier "double corner / Y-jump" with a straight takeoff is a **double hip**. A true corner has its takeoff facing across the slope.
- All landings use the EFH method from the Hip Jump Spec, not fixed landing angles.

## Shared building blocks

Eight blocks cover every feature in this catalogue. Each is a parametric generator: parameters in, render mesh + collider + metadata out.

| Block | What it is | Key parameters |
| --- | --- | --- |
| **Run-in** | Approach slope into a feature | Angle, length (solved from design speed) |
| **Takeoff** | Constant-radius transition into a straight lip | Lip angle θ, transition radius, straight length, lip height, width |
| **Table** | Flat top between lip and knuckle | Length, width, height offset (+ step-up, − step-down) |
| **Landing** | Constant-EFH profile, lofted across headings | Target EFH, heading range, side pitch, knuckle radius, bottom transition |
| **Ridge** | Rounded crest where two faces meet | Crest radius, face angles |
| **Wall** | Transition curving up to near-vertical | Radius, height, vert extension, plan shape (straight / angled / curved) |
| **Jib** | Rail or box on a spline | Spline, type (rail / box / tube), width, height |
| **Mound** | Smooth natural bump from filtered noise | Height, radius, shape (round / elongated / overhang) |

Composition is data: a feature is a list of blocks with offsets and orientation. Hand-built and procedural parks use the same format.

## Straight jumps

Landing in line with the takeoff. All share Run-in + Takeoff + Landing; they differ in the table and height offset.

| Feature | Built from | Key parameters | Status |
| --- | --- | --- | --- |
| **Kicker / tabletop** | Takeoff + Table + Landing | Size preset, table length 3–25 m | Built |
| **Gap jump** | Takeoff + void + Landing | Gap length; void = no collider, terrain dropped below | Spec'd |
| **Step-down** | Takeoff + Table (−offset) + Landing | Drop 1–6 m below lip | Spec'd |
| **Step-up** | Takeoff + Table (+offset) + Landing | Landing deck 1–3 m above lip; short landing | Spec'd |
| **Booter** | Takeoff + Landing, no table | Steep lip (top of θ range), long natural landing | P2 |
| **Big-air kicker** | Takeoff + long Table + Landing | XL preset, long landing for rotations | P2 |
| **Mini / roller kicker** | Takeoff + short Landing | S preset or smaller, θ 10–18°, no table | P1 |
| **Channel gap** | Two Takeoffs facing across a trench + Landings | Trench width and depth, runs down the fall line | P3 |

**Knuckle huck** is not a feature: it's riding off any landing's knuckle. It needs only a rounded knuckle with a pop allowed there, so make knuckles poppable surfaces in physics.

## Angled jumps (transfers)

The landing is not in line with the takeoff. All need in-air board alignment and slip measured against projected velocity (Hip Jump Spec, Physics).

| Feature | Built from | Key parameters | Status |
| --- | --- | --- | --- |
| **Hip** | Takeoff + optional Table + side Landing | Hip angle β 90° default (45–60° mellow), side, table length | Spec'd (Hip Jump Spec) |
| **Double hip** | Hip mirrored both sides | β per side, shared table, second landing | Spec'd |
| **Step-down hip** | Hip with Landing lower than lip | Drop 1–4 m; landing solved for the extra height | P1 |
| **Corner** | Takeoff facing across the slope + Landing along flight | Takeoff yaw 45–90° off fall line; outrun turns back downhill | Spec'd |
| **Spine** | Ridge with a Landing face each side | Crest radius ≥ 3 m, face angles from EFH | Spec'd |
| **Wedge / pyramid** | 2–4 Takeoff faces + Ridge top | Faces usable as takeoff or landing; rounded edges | P1 |
| **Euro gap** | Kicker + Jib on the table | Rail height ≤ table + 1 m, set back from the knuckle | P1 |

A wedge face hit from the side works as a hip; hit head-on, as a kicker. That's where discovery comes from: tag each face with both uses for the connection graph.

## Walls

The rider rides up and comes back down the same or a facing wall. These need a new physics mode: near-vertical riding, and air that lands back on the transition.

| Feature | Built from | Key parameters | Status |
| --- | --- | --- | --- |
| **Quarterpipe** | Wall, straight in plan | Radius 3–6 m, height, 0.3–0.5 m vert at the top | Built |
| **Halfpipe / superpipe** | Two facing Walls + flat bottom | Wall height, flat-bottom width, length down the fall line | P2 |
| **Mini pipe / channel** | Two low facing Walls | Height 1–2 m, narrow flat bottom | P3 |
| **Hip quarter** | Wall angled in plan | Angle 30–60°, so air lands on the next section | P3 |
| **Wall ride / berm** | Wall without vert, ridden along | Bank angle 30–70°; berm = low, wall ride = steep | P2 |
| **Tombstone / tap wall** | Short Wall with vertical face | Height 1–2 m, vertical face for taps and stalls | P3 |

Requirement for all walls: the rider's board stays aligned to the wall's surface normal while carving up, and air off the top keeps the rider's horizontal speed parallel to the wall so they land back on the transition.

## Natural terrain

No dye lines, no exact landings. Shapes come from Mound and noise; they must still pass the connection graph so they're rideable.

| Feature | Built from | Key parameters | Status |
| --- | --- | --- | --- |
| **Side hit** | Small Takeoff on a run edge | Height 0.5–1.5 m, angled 20–45° off the fall line | Built |
| **Roller** | Mound, elongated across the slope | Height 0.5–2 m, length 6–15 m | Built |
| **Knoll** | Mound, round | Height 1–3 m, radius 4–10 m; pop off the top or drop the back | P1 |
| **Cliff / drop** | Terrain step + Landing below | Drop 2–10 m; landing area solved with EFH at expected speed | Built |
| **Cornice / wind lip** | Mound with overhanging edge | Overhang 0.5–2 m; lip angle from wind direction | P3 |
| **Pillows** | Cluster of small Mounds in powder | 3–10 mounds, height 1–2 m, spacing 3–6 m; powder surface | P2 (needs powder) |
| **Log / stump** | Jib (bonk) + small Mound | Length, diameter; ollie over or bonk | P3 |

## Jump + jib combos

Airs onto or over rails and boxes. Rail classification follows the Trick Input spec (slide type from board angle at lock-in).

| Feature | Built from | Key parameters | Status |
| --- | --- | --- | --- |
| **Euro gap** | Kicker + Jib on table | See Angled jumps | P1 |
| **Gap to rail** | Small Takeoff + gap + Jib | Gap 1–4 m; rail start height matched to the arc at design speed | P2 |
| **Rail on table** | Table with a Jib along it, between two jumps | Rail ridden on the table; jumps either side | P2 |
| **Fun box** | Pyramid (wedge) with Jibs on faces | Box on top, rails down the sides | P2 |
| **Bonk features** | Jib in bonk mode (barrel, pole, wall) | Size; contact < 150 ms scores as bonk | P3 |

Rail start points on gap-to-rail features are solved from the flight arc, the same way landings are, so the rider can actually reach them at design speed.

## Build priority and Claude Code prompt

1. **Refactor existing features into the shared blocks.** Kicker, step-up/down, gap, side hit, roller, cliff and quarterpipe become compositions; behaviour must not change.
2. **P1 features:** step-down hip, wedge/pyramid, euro gap, knoll, mini kicker. Each reuses an existing block.
3. **Hip family** from the Hip Jump Spec (hip, double hip, tables, second landing).
4. **P2:** halfpipe, wall ride/berm, booter, big-air, gap to rail, rail on table, fun box, pillows (once powder exists).
5. **P3:** the rest, as content needs them.

**Prompt (per step):**

```
Read docs/feature-catalogue-spec.md, plus docs/hip-jump-spec.md, docs/terrain-spec.md and docs/landing-feel-spec.md for context.

Implement step <STEP> of the build priority.

Rules:
- Every feature is a composition of the shared building blocks (Run-in, Takeoff, Table, Landing, Ridge, Wall, Jib, Mound). Add a block only if no combination of existing ones works, and say why.
- Features are data: a list of blocks with offsets, orientation and parameters, loadable from the layout JSON.
- Landings and rail start points are solved from flight arcs with the EFH method; never hand-set angles.
- Tag every surface with its uses (takeoff, landing, hip, jib, bonk) for the connection graph.
- Colliders from parameters, not render meshes. Tunables in config + debug panel.
- Refactors must not change existing behaviour: compare before/after with the trajectory preview.

Start in plan mode: list files and which blocks each feature uses. After implementing, tell me what to test with a controller.
```
