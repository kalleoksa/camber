# CLAUDE.md

Freestyle snowboarding game. Solo personal project. Trick expression only — no scoring,
no multiplayer, no races, no progression.

**Design drivers, in priority order:**
1. Playability — it must feel good in the hand before it looks good on screen.
2. Truth to snowboarding — edge, weight, pop and rotation behave like a real board.

Everything else (visual fidelity, feature count, terrain size) is negotiable.

---

## Stack — locked, do not change

- TypeScript (strict), Vite, raw Three.js.
- `three-mesh-bvh` for terrain raycasts.
- Tweakpane for live parameter tuning.
- Gamepad API directly. No input library.
- No backend, no build step beyond Vite, no asset pipeline.

**Do not add a dependency without asking first.** Especially: no physics engine
(Rapier, Cannon, Ammo), no game framework, no ECS library, no state-management library,
no animation library, no React.

---

## Hard invariants

These are not preferences. Breaking one is a bug even if the code runs.

1. **The rider is a kinematic controller, never a rigid body.** We own `velocity`,
   `heading`, `edgeAngle` explicitly and integrate them ourselves. Snowboard feel comes
   from directly authored velocity transforms. Rigid-body solvers fight this and never
   feel right.
2. **Carving is velocity rotation, not friction.** A carve rotates the velocity vector
   toward board heading and bleeds a little speed. It is not a friction cone.
3. **Rider animation is procedural.** A skeleton driven by controller state (crouch,
   lean, twist) with IK hands to board attach points. No keyframed trick clips ever —
   the grab × tweak × rotation space is too large to author by hand.
   **Named anchor poses are not clips and are allowed.** An anchor is a preset of the
   ~20-number driver vector (design §7.2) — a method, an indy, a deep crouch — which
   gameplay interpolates toward and which stays composable with spin, stance and edge.
   You are presetting drivers, not a skeleton. The moment an anchor needs a *timeline*,
   it has become a clip and this invariant is broken.
4. **Sim is deterministic.** Same params + same recorded input = same frames, always.
5. **Sim and render are separate.** `src/sim/**` must not import Three.js scene objects,
   read the clock, read input directly, or touch the DOM. It receives an input snapshot
   and a dt, and mutates state. Render reads state and draws it.
6. **No unseeded randomness.** All randomness goes through the seeded PRNG in
   `src/sim/rng.ts`. Snow spray particles are render-side and may use `Math.random`.
7. **Zero allocation in the sim loop.** `tick()` and everything under `src/sim/**` that
   it reaches must not allocate: no object or array literals, no closures, no methods
   that build a new value. Vector helpers write into an out-parameter, scratch buffers
   are module-level and reused. A GC pause does not change the numbers, but it blows the
   frame budget and makes the accumulator catch up in a burst, which reads as a hitch.
   The recorder is exempt while recording — building an array of frames is its job.
   Enforced by review, not by a test: V8's escape analysis and allocation sinking defeat
   the obvious automated checks. Retained-heap deltas, scavenge counting and
   `--heap-prof` sampling were all tried and none of them can tell a deliberately leaky
   `tick()` from a clean one. Read the diff instead.

---

## Architecture

```
src/
  main.ts              bootstrap only
  core/
    loop.ts            fixed 120 Hz sim tick, interpolated render, accumulator
    rng.ts             seeded PRNG
  input/
    gamepad.ts         Gamepad API -> InputSnapshot (normalized, deadzoned)
    recorder.ts        record/replay InputSnapshot per tick to JSON
  sim/
    state.ts           RiderState type — the single source of truth
    params.ts          EVERY tunable number, one flat object
    rider.ts           tick(state, input, params, terrain, dt)
    states/            grounded.ts airborne.ts railed.ts walled.ts bailed.ts
    terrain.ts         BVH raycast queries: height, normal, surface type
  render/
    scene.ts
    rig.ts             procedural skeleton + IK
    camera.ts          chase spring, speed FOV, edge roll
    effects.ts         spray, trail, wind
  audio/
    layers.ts          edge, base, wind, impact — all speed/state driven
  park/
    park.json          feature definitions as data
    loader.ts          JSON -> geometry + collision + rail splines
  tuning/
    panel.ts           Tweakpane bindings, preset save/load
```

Fixed timestep is 120 Hz. Render interpolates between the last two sim states.
This exists for determinism, not performance.

---

## Parameters

Every number that affects feel lives in `src/sim/params.ts`, flat, with a unit comment.
No magic numbers in sim code — if you need a constant, add it to params and bind it in
Tweakpane in the same commit.

Presets serialize to `presets/*.json` so a feel can be saved, diffed, and A/B'd.

---

## Milestones — sequential, gated

Do not start a milestone before the previous one's gate passes. Do not implement
features from a later milestone "while we're in here."

| # | Milestone | Gate |
|---|---|---|
| 1 | Harness: slope, capsule, gamepad, Tweakpane, record/replay | A recorded take replays frame-identically after a param change |
| 2 | Carving: gravity, edge grip, speed, spray, sound | Carving an empty hill is satisfying with nothing else in the scene |
| 3 | Air: pop, rotation, landing tolerance, bail | Straight airs and a 360 land cleanly and read correctly |
| 4 | Grabs + procedural rig | A method you'd be happy with is reachable from sliders alone, in pose mode, before any gameplay code is wired to the rig |
| 5 | Rails: attach, slide variants, balance, exits | 50-50, boardslide, tailslide all feel distinct; balance is winnable but not free |
| 6 | Wallrides + butters | Both chain into and out of other states without a hitch |
| 7 | Park as JSON data | A new line can be built by editing park.json only |
| 8 | Feedback layer: replay cam, audio mix, clean/sketchy read | The game communicates style without a number |

Milestone 4's gate is a slider test on purpose: if a good method isn't reachable by hand,
no amount of gameplay code will generate one. Use video reference, including your own
footage, to set the anchor poses.

---

## Working agreement

- **Ask before:** adding a dependency, changing an invariant, restructuring directories,
  or introducing an abstraction that spans more than two files.
- **Just do:** implementation inside the current milestone, param additions, tests for
  determinism, refactors contained to one file.
- **Never do:** invent scoring, add UI chrome, add menus, add a tutorial, "polish" a
  milestone that hasn't passed its gate.
- Feel cannot be delegated. When a milestone lands, stop and say what to tune and which
  params to reach for. Don't guess at whether it feels right.

## Code style

- Simplicity over cleverness. This project gets picked up after months away.
- Prefer plain functions and plain objects. Classes only for genuine instances (Rider,
  Terrain, Park).
- Brief inline comments only where the *why* is non-obvious — especially in the ground
  model math.
- No README, no diagrams, no docblocks unless the complexity actually demands it.
- No `any`. No non-null assertions in sim code.

## Anti-patterns seen in snowboarding game code — avoid all of these

- Steering by rotating the mesh and moving forward along its facing (loses momentum,
  feels like a car).
- Turn rate independent of speed (you can pivot on the spot; kills carve identity).
- Snapping rotation to 90° increments during flight instead of at landing.
- Keyframed trick animations selected by button combo.
- Air control with full authority (removes all takeoff skill).
- Landing validated on rotation count alone, ignoring board-vs-velocity angle.
