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

## 2. Jump shape — *first pass done*

Home park kickers: takeoffs cut square (`sideTaper` 0.3 → 0.5 m real) on tables that round
off (`deckTaper`), 6 → ~10 m wide, pink lines along the lip and both sides of the ramp,
fine grid rows/columns at lips and cut sides. The corner's takeoff is cut the same way (its
side landings keep a 3 m fade-in, `deckTaper`) and kicks up short and steep — 57° over 15 m,
was 26° over 36 m — to a deck as wide as the lip; every quarter pipe has a line along its
coping. The corner's deck is outlined too: the knuckle on all three sides.

**These lines are park paint.** Backcountry features (kickers, natural hits — to come) are
built without them.

Still open: transition shape (below).


From the references, the takeoff is what reads:

- **Cut sidewalls**, near-vertical, instead of `sideTaper` rolling the sides off over 2–3 m
  (reads as a mound). Needs fine grid columns/rows at the edges, as walls have.
- **Tall, tight transition** to a clear lip; check `lipAngle` 0.5 (29°) against 30–35°.
- **Wider**: ~8–10 m real.
- **Edge lines** along the lip and both sidewalls (the references' red lines). Gameplay as
  much as look: they let you read the lip and the speed from distance.
- Flat table behind — already there.

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
3. **More grabs** as anchors: seatbelt, crail, rocket, bloody dracula, double grab (two
   grab points: rig change). Poses are yours to author. Weddle = mute, already there.
4. **Haptics**: rumble on pop, rail lock, landing, bail (`params.haptics`, Chrome only). — *done*
5. **Lip timing**: measure how much a pop at the lip vs early changes the air; cue it by
   sound, not UI.
6. **Input overlay**, a panel toggle: live sticks, triggers, bumpers — also during replays.
   — *done*

Left out, and why: scoring, trick book unlocks (progression), angle numbers on screen,
wind-up meter and lip highlight (UI chrome — CLAUDE.md); spin on the right stick (collides
with grabs; current left-stick spin/flip works); grabs on LB/RB (those are shifty and rail
slide; the stick-as-board-point grab covers more); camera presets on the D-pad (feedback
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

- Clothes phase 2: skinned lower body (pants bend at the knee instead of rigid tubes).
- Loose feel: step 1 (your tuning pass on the body springs) and step 3.
- `nosegrab`: the front knee goes ~10 cm through the deck in the authored pose (pose data).
- `npm run gate` fails `method path reach 1.0109` — on main too, predates the spine work.
- Halfpipe: wall-to-wall transfers untested by script; tune `HALFPIPE_*` and `WALL` in play.
- Anchors have no `spineCurl` yet — the riding hunch rides on top; author curl per grab.
- Keyboard: `STICK_RATE` and `GRAB` in `src/input/keyboard.ts` once played.
