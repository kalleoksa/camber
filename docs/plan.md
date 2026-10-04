# Plan — scale, jumps, look

Order matters: §1 decides every park size, so §2 and §3 build on its answer.

---

## 1. Gravity and scale — experiment in, decision open

**Finding.** Takeoff speeds are already real; the jumps are not.

| | ours (sim) | real |
|---|---|---|
| small kickers | 43–48 km/h | L park jump ≈ 43 km/h (Swiss study, 2023) |
| big kickers | 51–58 km/h | XL park jump ≈ 49 km/h; contest 20 m tables 60–70 km/h |
| corner | 59 km/h | slopestyle up to ~90 km/h |

The sim runs at 16 m/s², and every park is built at 0.61 of real size so that v² = 2gh
still gives real speeds (sochi.ts). The cost is size and time: jumps look 0.61 of the
references, and airtime is 0.61 of real. Real speed, real size and snappy airtime — only
two of the three hold together.

**Adopted (2026-10-02):** real gravity is the default. `params.world.gravity` 9.81, pop × 0.78
(an ollie as high in metres as before), drag ÷ 1.63; every park is laid out at the old
scale and exported × 1.63 (`scalePark`, rails keep their height). Spin model 1 is the
default too (`?spin=0` for the older one). Takes recorded before carry their own params and
terrain, so they replay as they were.

**Follow-up** (not started):
- Spin and flip rates (`air.spinTakeoff`, `flipRate`, `checkRate`) against the longer air.
- `air.levelRate`, `land.*` tolerances, `bail.*` timings — re-feel.
- Real drag back up and the grades retuned for it (drag here is already below a real rider's).
- Camera distance and FOV for bigger features; spray and audio speed curves unchanged.
- Rail lane: third jib table is hit at ~17 m/s — move it up the hill either way.

Jump line spacing tightened (`GAP_*` in park.ts): big kickers ~62 m apart, was ~72.

## 2. Jump shape — *done*

Home park kickers: takeoffs cut square (`sideTaper` 0.3 → 0.5 m real) on tables that round
off (`deckTaper`), 6 → ~10 m wide, pink lines along the lip and both sides of the ramp,
fine grid rows/columns at lips and cut sides. The corner's takeoff is cut the same way (its
side landings start square at the lip too, `deckTaper`) and kicks up short and steep — 49° over
14 m, was 26° over 36 m — to a deck as wide as the lip; every quarter pipe has a line along its
coping. The corner's deck is outlined too: the knuckle on all three sides, and the side landings' cut
uphill ends.

**These lines are park paint.** Backcountry features (kickers, natural hits — to come) are
built without them.

Kicker transitions shorter and steeper: lip 34° (was 29°), big ones ~16 m of ramp (was 19).
The table's uphill face no longer rises in front of the takeoff — it had been rounding every
lip off to ~23° whatever `lipAngle` said (the corner had the same bug).


## 3. Look — after §2

In order of impact. All render-side and procedural (canvas textures, simple geometry, like
the camo): no asset pipeline, nothing in `src/sim/**`.

1. **Snow**: toon bands on the terrain to match the rider; cool blue-violet shadows, a
   lower sun for long shadows; faint corduroy groom lines (also a speed and slope cue).
2. **Feature edge lines** (§2).
3. **Depth**: gradient sky, distant mountain silhouettes, fog; simple tree clusters on the
   side banks.
4. **Park dressing**: fences and flags along the line.
5. **Camera**: lower and closer behind the rider, as in the references.

## 4. From the trick input spec (Claude Docs, 2026-10-02)

What fits the invariants and the current control scheme:

1. **Rail naming** (`render/tricks.ts`): spin out ("bs boardslide 270 out"), lipslide vs
   boardslide from which end crossed the rail, blunts, bonk on a short touch, rail-to-rail
   transfers ("bs boardslide to 50-50"). — *done*; blunt is my reading of which end is
   over the rail, check it against how you'd call them.
2. **Off-axis names**: cork (spin-led), rodeo (backflip-led), misty (frontflip-led). — *done*
3. **More grabs** as anchors: seatbelt, crail, chicken salad, roast beef — *done*, your
   poses (§6). Still out: rocket, bloody dracula, double grab (two grab
   points: rig change). Weddle = mute, already there.
4. **Haptics**: rumble on pop, rail lock, landing, bail (`params.haptics`, Chrome only). — *done*
5. **Lip timing**: measure how much a pop at the lip vs early changes the air; cue it by
   sound, not UI.
6. **Input overlay**, a panel toggle: live sticks, triggers, bumpers — also during replays.
   — *done*

Left out, and why: scoring, trick book unlocks (progression), angle numbers on screen,
wind-up meter and lip highlight (UI chrome — CLAUDE.md); spin on the right stick (collides
with grabs; current left-stick spin/flip works); camera presets on the D-pad (feedback
marks live there); pause/menus; Vitest (dependency — the scripts already test recorded
takes); 60 Hz sampling (the sim is 120 Hz). The spec's rail-side convention (heelside =
backside) is the opposite of yours (blind boardslide = frontside); yours stands.

### Body sequencing (spec section, 2026-10-02)

- **Look** — *done*: arms, shoulders and hips wind against the coming spin, snap round in
  turn at the pop (arms, then ~35 ms, then ~75 ms), lead the board in the air and square up
  before touchdown (`rig.armWind` … `chainDamping`). No-grab airs ride compact: knees up,
  back rounded (`rig.airCrouch`, `airSlouch`, `airFold`).
- **Sim** — *done, behind `air.spinModel` = 1* (0 keeps today's rules; old takes pin 0):
  counter-rotation. While charging RT, push the stick away from the spin: the upper body
  winds up and the board holds its line (`windSteer` of the stick still edges). How long
  sets how much (`windTime` 0.5 s to full, a pad tick each third): ~0.18 s a 360, 0.25 a
  540, 0.35 a 720, 0.5 s a 1080 (real gravity). At the pop, point the stick the way of the
  spin to send it — how far you point, how much (up to `flickWindow` after the pop);
  held against or let go to centre, a straight air. A cork is the same point, diagonal:
  toward the spin and back (or forward) — `fullStick` 0.7 counts as full on each axis, and
  the flip reads past `corkDeadzone1` 0.25. In the air the rotation is fixed: push toward the spin to tuck (`tuckGain`, faster),
  against it to open (`openGain`, slower). Opening straightens the body: legs long, back up, arms
  out — the compact no-grab air hands over to it.

## 5. Carried over

- Clothes phase 2 — *done*: each pant leg is one tube skinned to thigh and shin (`pantLeg`), so
  the knee bends like cloth; outline hull skinned with it. Jacket black. Head from your photo:
  goggles on, black neck gaiter up to them, slouchy beanie over the ears.
- Loose feel: step 1 (your tuning pass on the body springs) and step 3.
- Halfpipe: wall-to-wall transfers untested by script; tune `HALFPIPE_*` and `WALL` in play.
- Grab anchors re-authored (crouch, indy, mute, method, stalefish); `npm run gate` passes.
- Anchors have no `spineCurl` yet — the riding hunch rides on top; author curl per grab.
- Keyboard: `STICK_RATE` and `GRAB` in `src/input/keyboard.ts` once played.
- Grab + shifty: a hand holding the board turns the whole rider through `rig.shiftyGrabTurn`
  (0.7) of the shifty, the rest twists the board under the body — before, the board yawed
  away under the hand (up to 16 cm short on nose/tail grabs). Sim side, grabs checked across
  all stick directions, tweak, shifty, switch and spins: consistent; a shifty held into the
  landing bails (52° off the line), by design.

## 6. Grabs on the bumpers (stick model 2, 2026-10-04)

The stick alone picked the hand from where it pointed, and a sideways stick sat between two
grabs, so a few degrees of thumb swapped hands. Now **LB is the left hand and RB the right**
(riding regular: front and back), and the right stick picks where the hand goes. The grab is
fixed as the hand reaches and held while both are held; push depth past `grab.tweakEnter`
tweaks it. Riding switch nothing mirrors — same buttons, same grab, "switch" in the name. A
bumper with the stick centred is still shifty; with a grab on, it isn't.

| Stick | LB — front hand | RB — back hand |
|---|---|---|
| ↑ nose | nosegrab | crail |
| ↗ | *free* | *free* |
| → toes | mute (full push: japan) | indy |
| ↘ | *free* | *free* |
| ↓ tail | seatbelt | tailgrab |
| ↙ | chicken salad | *free* |
| ← heels | melon | stalefish |
| ↖ | method | roast beef |

A free slot goes to the hand's nearest filled direction. Table: `FRONT_SLOTS`/`BACK_SLOTS`
in `src/sim/grabs.ts`. Each grab plays its own anchor exactly (no blend), board attitude
from `grab.<name>Pitch/Roll/Yaw`. Seatbelt, crail, chicken salad and roast beef are your
poses; chicken salad and roast beef reach between the legs to the **toe** edge, and their
hips were lowered (hipY) until the hand reaches in play. `npm run gate` still checks only
the original eight — it reads the four new ones as out of reach where play does not. Next:
bones (full push straightens a leg — rig work), two-hand grabs on LB+RB, the free slots.
Old takes keep stick models 0 and 1.

## 7. Butter 180s (2026-10-04)

Nose or tail press past `butter.press` plus the edge stick pivots the board on that end;
hold it for as long as the turn should go (~1 s for a 180 at `butter.yawRate` 3.2). Two
fixes made it a trick rather than a stop: up on an end the edge stick no longer bites
(`butter.edgeGrip` 0 — it scrubbed 6 m/s down to 1.5 with the board across), and the
switch latch flipping mid-pivot carries the held stick through (`ground.switchCarry` —
the smoothed press swept through zero and dropped the butter halfway). Named "fs/bs
nose/tail butter 180" (or 360, 540) in `render/tricks.ts`. Old takes pin both off.

## 8. Landing & Feel spec (2026-10-04)

Adapted to CLAUDE.md: no score, multipliers or angles on screen; tuning stays in `params.ts`
and Tweakpane; R2 is the absorb (the spec's LT stomp), L2 the speed check; surface profiles
wait until powder exists.

- **Terrain absorb** (render): the hips follow the board's up-acceleration on snow —
  `rig.terrainAbsorb`, `terrainAbsorbMax`; off during a landing's own absorb.
- **Skid** (sim): `land.skidCarry` of the touchdown yaw rate keeps turning the board on the
  snow, slowed at `land.skidDecel`; while it skids the board pivots (grip × `land.skidGrip`,
  travel keeps its line) and the landing correction waits; the carve rides out what's left.
- **Revert**: in the landing window (`land.absorbTime`) the right stick flicked the way of the
  skid turns the board round to the other stance, lined up with travel. Named "… to revert".
  A stick still held from a grab doesn't count until it has been near centre.
- **Save**: a landing sketchy only for its rotation, pushed the way that lines it up in the
  window, becomes clean and gets its speed back (`land.save`, `saveStick`).
- **Slope blend** (render): the drawn board eases from its air attitude onto the slope over
  `rig.landBlendClean` / `landBlendSketchy` instead of one tick.
- Trick names now appear when the landing window closes (0.22 s later), so revert and save show.
- Old takes pin all of it off.
- **Gap jumps** (terrain, from your big-air elevation): `KickerConfig.knuckleHeight` makes a
  kicker a separate takeoff and landing — the lip's back drops steeply to the slope
  (`backLength`, default 0.4 × lip), then the landing is its own hill, a smooth rise over
  `deckLength` to a knuckle `knuckleHeight` up, then knuckle, landing and run-out as before.
  The jump line uses it with the knuckle at half the lip (`KNUCKLE` in park.ts). A lower
  knuckle has less to drop, so the kicker's landing angle eases to keep the landing as long,
  and `LANDING_GRADE` (0.3) of that goes back as a steeper slope under it: landings ~22°
  (were 26°); more grade = steeper landings and a faster line (~+6 km/h a kicker at 1).
  Line speeds 41/45/50/56/57 km/h (were 41/44/50/57/58), all straight airs clean.
  Riding round the takeoff and up the rise onto the knuckle: from ~22 km/h on the small
  kickers, ~43 km/h on the big ones. The knuckle is dyed red. Takes keep their terrain.

## 9. Visual slope builder — to design and plan (2026-10-04)

Parks are built in code today (`src/park/*.ts`, numbers per feature). We need a visual way
to build slopes and lines. Not started; needs a design and a plan first. Open questions:

- Where it lives: a separate editor page beside the game, or an edit mode in it. CLAUDE.md
  rules out menus and UI chrome in the game, so this needs an explicit decision.
- What it edits: grades, kickers (gap / table), corners, rails, boxes, quarters, walls —
  placed and sized by hand, with the numbers still readable and tweakable.
- What it saves: milestone 7's park JSON (`park/park.json` + loader), so a line is data,
  diffable, and takes keep replaying on the terrain they stored.
- How you test a change: ride it straight from the editor, plus `npm run airs`-style checks
  (speed into each feature, airtime, landing spot) shown while placing.
- Dependencies: the stack is locked; anything beyond Three.js and Tweakpane needs asking.
