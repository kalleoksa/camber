# Missing obstacles — spec against the code

2026-10-05. Sources: Feature Catalogue Spec, Jump Designs Spec (`docs/feature-catalogue-spec.md`,
`docs/jump-designs-spec.md`), checked against `claude/project-analysis-plan-shg4g6` (PR #23):
`src/sim/terrain.ts`, `features.ts`, `hip.ts`, `src/gen/kit.ts`, `src/gen/config.ts`.

## How the code builds terrain — the rules every obstacle below follows

- **A feature is a height function above the ground.** Features merge by `max`, so each is ≥ 0.
  Nothing can cut below the ground: no trenches, pits or dug-out landings. Where a spec asks for
  a drop, the drop comes from the ground itself (a steep band in the generated field, or a
  `GradeConfig` in a hand park), and the generator places the feature where the ground already
  falls away.
- **One height per (x, z).** No overhangs, no truly vertical faces. A near-vertical face is a steep
  heightfield face; the quarter pipe's `vertExit` rule already fakes the vertical top for airs.
- **New terrain shapes are new `ShapeConfig` kinds** in `features.ts` (own frame, `yaw`,
  `inFrame`), so the layout format, footprints and `turned()` work unchanged. Kicker, hip and
  quarter variants are options on `KickerConfig`, `HipShape` and `QuarterConfig`.
- **Composites are several `FeatureSpec`s sharing `meta.group`** (new field: a number). The editor
  moves, mirrors and deletes a group as one. No composite config type.
- **Kit functions in `src/gen/kit.ts` size every obstacle** from the speed where it stands, and
  solve landings from flight, as `designKicker` already does. Never hand-set landing angles.
- **Landing quality uses the game's impact test**, not the spec's EFH metres: `land.impactSketchy`
  13 m/s, `land.impactBail` 17 m/s into the surface. The spec's 1.0 m EFH is 4.4 m/s, so its
  thresholds would grade nearly every landing in the game as sketchy (plan §13).
- **Paint:** park obstacles get edge lines on the lip, knuckle and coping. Natural ones (booter,
  cliff, knoll, cornice, natural side hit) get none. Turned features get no paint today (`scene.ts`
  `edgeLines` skips `yaw`); fix that first, since most generated features are turned.
- **Done when:** each obstacle has a scripted check in the style of `kit-check` or `line-check`.
  The bot rides it at its design speeds and prints grade, impact and metres past the knuckle.

## Coverage

| Spec obstacle | Status | Where |
|---|---|---|
| Tabletop / gap / big-air kicker | Exists | `KickerConfig`, `designKicker`, home park big-air |
| Step-up | Exists | `designStepUp` (`knuckleHeight` + `topLength`) |
| Hip, double hip | Exists | `hip.ts`, `designHip` |
| Spine, roller, side hit | Exist | `features.ts` |
| Quarterpipe, halfpipe, wallride wall | Exist | `QuarterConfig`, `WallConfig`; halfpipe in home park only |
| Rails, boxes, jib tables, bonk naming | Exist | `rails.ts`, Sochi, `render/tricks.ts` |
| Step-down | **Missing** | §1 |
| Mini kicker | **Missing** | §2 |
| Booter | **Missing** | §3 |
| Corner (takeoff across the slope) | **Missing** | §4. The code's "corner" is a hip |
| Step-down hip | **Missing** | §5 |
| Wedge / pyramid | **Missing** | §6 |
| Euro gap | **Missing** | §7 |
| Gap to rail | **Missing** | §8 |
| Rail on table (generated) | **Missing** in the generator | §9 |
| Log / stump | **Missing** | §10 |
| Knoll | **Missing** | §11 |
| Cliff / drop | **Missing** | §12 |
| Mini pipe | **Missing** | §13 |
| Berm, turned wall ride | **Missing** | §14 |
| Hip quarter | **Missing** | §15 |
| Fun box | **Missing** | §16 |
| Tombstone / tap wall | **Missing**, needs a sim rule | §17 |
| Channel gap | **Missing**, needs a rethink | §18 |
| Cornice / wind lip | **Missing**, approximated | §19 |
| Pillows, bonk solids, superpipe zone | **Deferred** | §20 |

## Obstacles

### 1. Step-down

Landing starts lower than the lip, so more airtime at the same speed.

- **Build:** `KickerConfig` gap build, `knuckleHeight` below `lipHeight`. Drops up to the lip
  height come from the feature. Bigger drops (spec: 1–6 m) come from the ground: place the
  takeoff on the last of a bench, with the landing on the steep band below.
- **Kit:** `designStepDown(place, size, drop)`. Same solve as `designKicker`, but the flight and
  ride run over the **real layout terrain**, not a plane at the local grade. This is the shared
  prerequisite for §1, §3, §4 and §12: the kit gets a `terrainAt(place)` sampler.
- **Starting values:** sizes S–XL, lip 18–26°, table 0–10 m, drop 1–6 m.
- **Generator:** every generated kicker is solved over the real ground; one whose ground falls
  ≥ 0.5 m below the run-in's grade 30 m on is labelled a step-down. Generated ground is gentle
  (mostly 10–20°): a 1 m drop at 20 m fit 0.7% of spots, 0.5 m at 30 m fits about a quarter.
- **Done when:** the slowest air clears the knuckle, and mid speed lands clean.

### 2. Mini / roller kicker

Small filler between bigger features, for pop practice and small spins.

- **Build:** `SideHitConfig` with park paint. Height 0.3–0.7 m, angle 10–18°, back 1.5 m.
  You land on the slope.
- **Kit:** `designShape('sideHit', …)` with a `mini` range in `GEN.mini`.
- **Generator:** in lines between features, where spacing leaves ≥ 25 m. Fill odds 0.1.
- **Done when:** popped at 6–10 m/s, it lands clean. (With a full pop it carries 9–18 m, not
  the 3–8 m first written here; distance is the pop's.)

### 3. Booter

Big backcountry kicker, no table; the natural slope below is the landing.

- **Build:** `KickerConfig` with no landing (`landingLength: 0`, steep `backLength`). Lip
  28–32°, height 2.5–4 m.
- **Kit:** `designBooter`: a natural side hit (lip 28–32°, 2.5–4 m) kept only where, over at
  least 2 m/s of speeds in 10–18, a medium air lands clean on ground 22–38° steep, then one
  real ride at the middle speed. The generator's ground has almost none: 2 of 120 spots fit.
- **Generator:** natural zones only. The generated steep bands (28–35°) are the landings. No paint.
- **Powder** is not required; it can come later.
- **Done when:** mid speed lands clean on the steep band; max speed doesn't overshoot it.

### 4. Corner (takeoff across the slope)

Takeoff faces 45–90° off the fall line; the landing lines up with the flight, and the outrun
turns back downhill after the landing.

- **Naming:** the code's `HipConfig` (formerly `CornerConfig`) is a hip; its data keys
  `corners` and `kind: 'corner'` keep the old name so takes and layouts load. Use
  `meta.type: 'corner'` for this obstacle.
- **Build:** `KickerConfig` with `yaw` 45–70° and new option `tilt` (rad the ground falls
  across it): the low side is built up in proportion to the feature's height, so the lip is
  level and the landing level at its knuckle, easing back to the ground's cross-fall at the
  run-out. Past ~70° the axis is nearly a traverse and fast airs overshoot onto flat ground,
  so 45–70° and sizes S–M.
- **Kit:** `designCorner(place, size, yaw)`, solved over the real terrain (§1).
- **Outrun:** the ground turns the rider back downhill; nothing built. Optionally a berm (§14)
  on the outside.
- **Done when:** both stances land clean at mid speed, and the outrun returns to the fall line
  within 10–15 m without the rider stopping.

### 5. Step-down hip

A hip whose side landing sits lower than the lip.

- **Build:** `HipShape.stepDown` (m, 1–4): the takeoff is built that much taller over the same
  table and landings, its back dropping to the table steeply. (Lowering the table instead, as
  first written here, shortens the landing — the ground under it can't be cut — and bails.)
- **Kit:** `designStepDownHip` (`designHip(…, stepDown)`): a flight-sized hip (below) with
  its lip 1–4 m above the deck instead of the size's own. In the generator's odds.
- **Done when:** side airs at 30° aim land clean at mid speed, as `designHip` does now.

### 6. Wedge / pyramid

A raised block whose faces work as takeoffs or landings depending on approach. Head-on it's a
kicker; from the side, a hip; straight across, a spine.

- **Build:** new `ShapeConfig` kind `wedge`. Parameters:
  - `faces`: 2 or 4
  - `height` 1.5–3 m
  - `faceAngle` 20–25°
  - `baseRadius`: transition at the foot of each face
  - `top`: deck size for 4 faces; crest radius ≥ 3 m for 2 faces

  Height = the minimum over the faces of each face's profile, measured inward from its base
  line, capped by the top. Edges round over `taper`.
- **2-sided wedge vs spine:** same build, but takeoff-shaped faces (transition then straight).
  The spine's faces are landing-shaped (knuckle then straight).
- **Generator:** fill only, odds 0.08. Tag every face as takeoff and landing for the
  connection graph (generator step 7).
- **Done when:** each face, hit head-on at its design speed, lands clean on the slope or on
  the opposite face.

### 7. Euro gap

A tabletop with a rail or box on the table that the rider airs over.

- **Build:** group of two.
  - `KickerConfig` table build (`deckWidth`, no `knuckleHeight`), table 8–18 m.
  - `RailConfig` along the axis on the table: height ≤ 1 m, 4–8 m long, ending ≥ 2 m
    before the knuckle.
- **Kit:** `designEuroGap`. Rail height is clamped so the **slowest** air (min speed, mid pop)
  clears it by 0.5 m. A rider who doesn't clear it lands on the rail (a real jib) or the table.
- **Done when:** min speed clears the rail; a deliberate short air locks onto the rail.

### 8. Gap to rail

A small takeoff, a gap, then a **down rail**.

- **Build:** group of a painted side hit and a `RailConfig` running from 0.5–2.5 m above the
  snow down to 0.5 m, steeper than the slope. A flat rail doesn't work on a 12–20° slope: the
  air rides 2–3 m above the falling snow, and by the time it's down to a flat rail it comes in
  steeper than `rail.captureAngle` allows, so it goes through to the snow.
- **Kit:** `designGapToRail`, placed from real rides (`rideArc` in `ride.ts`), not the flight
  model, because small lips launch lower than the model says. With a half charge, the rail
  starts where the air is 0.15 m above its top and must meet it within 75% of the capture angle.
  The design speed is the one in 3–8 m/s whose gap (takeoff back to rail) is nearest 2.5 m.
- **Done when:** popped (half or full) at its design speed, it locks on and slides to the end.

### 9. Rail on table (generated)

Sochi's jib tables are hand-built. The generator gets a kit function.

- **Build:** group of a jib table (`KickerConfig`, low lip as in `park.ts` `jibLip`) and a rail
  or box along its deck.
- **Kit:** `designJibTable`. Rail 6–12 m, starting 1 m past the lip. In line mix as part of
  `rail`'s odds (half the rails go on tables).
- **Done when:** rail speed (`lines.railSpeed` 4–10 m/s) carries the rider to the end.

### 10. Log / stump

- **Build:** group of a `RailConfig` (round, 3–6 m, 0.3–0.6 m high) and a roller under it,
  height 0.3 m. Bonk naming already exists (short touch).
- **Generator:** natural zones, fill odds 0.05. No paint.

### 11. Knoll

Round natural mound: pop off the top or drop the back.

- **Build:** new `ShapeConfig` kind `knoll`. Height 1–3 m, `radiusUp` 4–10 m,
  `radiusDown` (default = `radiusUp`; shorter for a steeper back). Cosine profile by radial
  distance, split front/back along the fall line.
- **Generator:** fill odds 0.08. No paint.
- **Done when:** popped at its crest at 8–14 m/s, it lands clean on the back or the slope.

### 12. Cliff / drop

A 2–10 m drop with a landing below.

- **Build:** the ground cannot step down, so the cliff is built as a **raised shelf**: new
  `ShapeConfig` kind `shelf`. It rises gently from uphill over 30–60 m, holds flat at `height`,
  then ends in a face at 60–80°. The landing is the ground below, so place it where the field
  is steep (28–35°).
- **Kit:** `designDrop`, with the drop height solved so mid speed lands clean on the band below
  (§1's real-terrain solve). No paint.
- **Riding into the face** at low speed is a ride down a steep heightfield face, not a fall.
  Accept it.
- **Done when:** mid speed off the edge lands clean; walking speed rides down without a bail.

### 13. Mini pipe

A small halfpipe low enough to ride wall to wall at park speed.

- **Build:** two `QuarterConfig` with `side` ±1, facing, as the home halfpipe. Height 1–2 m,
  radius 2–3 m, `angle` 60–70° (no vert), flat 3–6 m, length 30–60 m.
- **Kit:** `designMiniPipe`. Generator: fill odds 0.04, on a 10–15° grade.
- **Check:** `vertExit` applies once the face's normal passes `wall.vertFace`. Airs come back
  in, which a mini pipe wants.
- **Done when:** the bot pumps wall to wall for the length without stopping.

### 14. Berm and turned wall ride

- **`WallConfig` gets `yaw`** (it can only run straight down the fall line today), via `turned()`.
- **Berm:** new `ShapeConfig` kind `berm`, a banked turn.
  - `radius` 8–20 m, `sweep` 45–120°, `bank` 30–50°, `height` 1.5–3 m.
  - Height comes from radial distance off the turn's centre line. The ends fade over `taper`.
  - 50° is under `wall.minAngle` (65°), so a berm rides as a carve on snow, not a wallride.
    That's intended: speed retention in turns.
- **Generator:** berms where a line turns > 25°, on the outside.
- **Done when:** a line through the berm keeps ≥ 90% of its speed over a 90° turn.

### 15. Hip quarter

A quarter pipe whose coping changes direction, so air off one section lands on the next.

- **Build:** two `QuarterConfig` with `yaw` 30–60° apart, meeting at a mitred corner. New
  option `mitre`: the plane where each section's height ends, so `max` doesn't leave a crease.
- **Physics check first:** `vertExit` sends an air back to the face it climbed, keeping
  velocity along the coping. A transfer only happens if that along-coping speed carries the
  rider past the corner. Measure before building the generator side. If transfers don't
  happen, `vertExit` needs the corner's other face (a sim change; ask).
- **Done when:** an air aimed along the coping at mid speed lands on the next section.

### 16. Fun box

- **Build:** group of a 4-face wedge (§6) with a box on its deck and rails down two faces.
- **Kit:** `designFunBox` after the wedge.

### 17. Tombstone / tap wall — needs a sim rule

A 1–2 m near-vertical wall for taps and stalls.

- **Shape:** buildable as a `QuarterConfig` with `angle` ≈ 83° and a 0.3–0.6 m deck.
- **Physics:** the sim has no rule for touching a near-vertical face from the air. Today it
  goes through the landing test and bails. A tap needs a new contact rule:
  - an airborne contact with a surface steeper than `tap.minAngle` and a short touch keeps
    the rider airborne;
  - it reflects the into-face velocity × `tap.restitution`;
  - it's named "tap" (or "stall" when held, as on a rail).
- **Status:** a sim change across `airborne.ts` and `tricks.ts`; design before building.

### 18. Channel gap — rethink

The spec digs a trench, which the max-merge rule can't do. Equivalent build: two side-hits
(§2 values, height 1–1.5 m) facing each other across 4–8 m of slope, running down the fall
line. Priority: last of the parks.

### 19. Cornice / wind lip — approximated

No overhang is possible. Build a `sideHit` with angle 35–40°, height 0.5–2 m and a short,
steep back, on a ridge in natural zones. Lowest priority.

### 20. Deferred

- **Pillows:** need a powder surface (`SurfaceType 'powder'`: drag, sink, softer impact).
  Specify powder first.
- **Bonk solids** (barrel, pole): need collision with a solid that isn't the ground or a rail.
  Short rails and boxes already bonk.
- **Superpipe zone:** the halfpipe exists; a 6.7 m, 100–180 m pipe is a size and zone question.
  Revisit after the generator's step 9.

## Build order

1. **Turned-feature paint** and `meta.group` in the layout. *Done.*
2. **Cheap, on existing machinery:** mini kicker, knoll, log, mini pipe, euro gap, gap to rail,
   jib tables in the generator. *Done* — `npm run obstacle-check` rides each one; results below.
3. **Real-terrain solve in the kit**, then step-down, booter, cliff, corner. *Done* —
   `groundFrame` / `stack` in `kit.ts`; every generated kicker is now solved over the real
   ground (slowest air short of the knuckle: 21 of 60 → 5 of 61 on seeds 1–3).
4. **New shapes:** wedge (then fun box), berm and wall `yaw`, step-down hip. *Done* (step-down
   hip out of the generator, see §5).
5. **Physics first:** the hip quarter measurement, then tombstone taps (ask before the sim
   change).
6. **Last:** channel gap, cornice. Deferred: pillows, bonk solids, superpipe.

Each step adds its kit function, `GEN` values, a generator odds entry, a footprint check, and
a scripted ride check. Every number goes in `GEN` (generator) or the config type (terrain),
never inline.

## Step 2 results (`npm run obstacle-check`, 2026-10-05)

| Obstacle | 12° | 20° |
|---|---|---|
| Mini kicker, 6/8/10 m/s, full pop | clean, 9–16 m | clean, 10–18 m |
| Knoll, 8/11/14 m/s, pop at crest | clean | clean |
| Log, 6 m/s | small pop: short slide (0.2–0.3 s); full pop: clears it | same |
| Euro gap M/L, slowest speed | no pop: lands on the rail; half/full pop: clears it, clean | same |
| Euro gap M/L, top speed | half pop clean (M); full pop sketchy, overshooting as kickers do | L sketchy at 15 m/s |
| Gap to rail, design speed | half/full pop: locks on, slides to the end, clean | same |
| Jib table, 5/7 m/s, small pop at the rail | locks on, rides to the end | same |
| Mini pipe (12° only), down the middle / 3–7 m/s into a wall | doesn't stop; airs out of the walls and back in, 0 bails | — |

Known: the generated terrain mesh is 2 m cells, so a mini pipe's 1–2 m walls render as soft
rolls; the sim surface is exact. A finer mesh is the editor's tiled-mesh prerequisite.

## Step 3 results (`npm run obstacle-check`, real ground)

Test ground: 12° steepening to 32° (step-down, booter, drop); a 13° plane crossed at 60°
(corner).

| Obstacle | Result |
|---|---|
| Step-down M, 9 and 13 m/s, no / half / full pop | clean every time |
| Booter, 10–14 m/s, no / half / full pop | clean every time |
| Drop (6 m shelf), rolled off at 3–14 m/s | clean every time |
| Corner M at 60° | levelled from 11.3° to 1.7° cross-fall past the knuckle; slowest speed no pop clean; full pop and top speed sketchy |

The corner's sketchy airs come mostly from the test bot: with the stick neutral it can't hold a
traverse, drifts 1–3 m down the cross-slope and lands off the levelled part. Needs riding.

In generated parks (seeds 1–4) step-downs appear 4–8 times a park; booters and drops once in a
few parks, because the generated ground has almost no slope over 25°. A natural zone with steep
ground would make room for them.

## Step 4 results (`npm run obstacle-check`, 14° plane)

| Obstacle | Result |
|---|---|
| Pyramid (4 faces) and wedge (2), head-on at 8 and 11 m/s, no / half pop | clean every time |
| Fun box, 7 m/s, small pop at the box | locks on the box, then the rail down the face, clean |
| Berm (r 14 m, 91°, bank 37°) | 31° from level at its steepest halfway round; no ride check — the bot can't steer a turn |
| Wall ride turned 30°, 10 and 13 m/s with 7 m/s into it | wallrides, comes off clean; 3 m/s into it never climbs to the steep part |
| Double hip M (unchanged) / step-down hip M (+2.9 m), 15 m/s straight and 6 m/s across | hip: sketchy; step-down: bails across. Out of the odds |

The bot points its board along its velocity (a crab across a hip bailed even the plain hip).

## Hips sized from flight (2026-10-05)

`designHip` no longer scales the home corner. Takeoffs come from the hip jump spec's S–XL
presets (lip angle, straight lip, lip height above the deck, width, table, aim range, knuckle
radius). On this ground a side landing can only fall as far as the deck stands above it, so the
deck's height and the landing's grades are solved:

- flown at the slowest, middle and top speed, at the low, middle and high aim, over the real
  ground;
- the lowest deck whose medium airs at the middle speed all land clean, and whose middle and
  top-speed airs at the middle and high aim come down on the landing, not on the ground past it;
- the table ends short of where the middle air at the lowest aim comes down.

Two changes from the spec's presets, both because they land sketchy on any deck searched:

- speeds are the kickers' sizes (S 7–10, M 9–13, L 12–15, XL 15–18 m/s), not S 8–11 … XL 17–21;
- XL's lip is 26°, not 30°.

Results:

| | Deck | Rides (middle speed, half pop, 3 aims × 3 speeds), 14° plane |
|---|---|---|
| S | 3.5 m | 8 clean, 1 sketchy (highest aim, slowest) |
| M | 4.5 m | all clean |
| L | 6.5 m | all clean |
| XL | 13.5 m | all clean — a hero build |
| Step-down M (+2.9 m lip) | 4.5 m | all clean |

Generated parks, seeds 1–4, every hip ridden at its middle speed, half pop, aims 10/20/30°:
clean 37 of 48 (was 6 of 15 with the scaled home corner), no bails. Bigger hips take more room:
seed 1 has 55 features (was ~66).
