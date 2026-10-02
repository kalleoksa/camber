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

**Experiment: `?g=real`** (main.ts, `src/park/scale.ts`).

- Gravity 9.81, every park length × 1.63 (rails keep their height above the snow).
- Pop × 0.78 so an ollie is as high in metres as before.
- Air drag ÷ 1.63 — it acts per metre, so a longer park would otherwise bleed the speed
  the jumps were sized for.
- Everything else as tuned. Measured on straight lines: all five kickers land clean,
  39–58 km/h, 2–3 s of air (about 1.6× the default), 4–10 m past the knuckle; corner
  57 km/h, lands clean both sides.

**To feel:** hang time on the big jumps, whether spins now over-rotate (same rates, more
time), pop feel, carving and the halfpipe at the new size. Speed readout now shows km/h.

**If adopted** (follow-up, not started):
- Spin and flip rates (`air.spinTakeoff`, `flipRate`, `checkRate`) against the longer air.
- `air.levelRate`, `land.*` tolerances, `bail.*` timings — re-feel.
- Bake the scale into the park files and drop the switch; real drag back up and the
  grades retuned for it (drag here is already below a real rider's).
- Camera distance and FOV for bigger features; spray and audio speed curves unchanged.
- Rail lane: third jib table is hit at ~17 m/s — move it up the hill either way.

Jump line spacing tightened (`GAP_*` in park.ts): big kickers ~62 m apart, was ~72.

## 2. Jump shape — after §1

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
  hold RT with the stick pushed to wind up (`windTime` 1 s to full, only ever builds while
  RT is held, a pad tick at each third); the wind-up is how much — flicked across at the
  pop it all goes into the spin the other way, held through `windGain` of it goes that way.
  Roughly 0.35 s of wind is a 360, 0.5 a 540, 0.7 a 720, 1 s a 1080 (real gravity). The flick is read by stick position, anywhere from ~0.15 s
  before the release to `flickWindow` after. In the
  air the rotation is fixed — the stick only tucks (toward the spin, `tuckGain`) or opens
  (against it, `openGain`), and has to pass through centre first, as now.

## 5. Carried over

- Clothes phase 2: skinned lower body (pants bend at the knee instead of rigid tubes).
- Loose feel: step 1 (your tuning pass on the body springs) and step 3.
- `nosegrab`: the front knee goes ~10 cm through the deck in the authored pose (pose data).
- `npm run gate` fails `method path reach 1.0109` — on main too, predates the spine work.
- Halfpipe: wall-to-wall transfers untested by script; tune `HALFPIPE_*` and `WALL` in play.
- Anchors have no `spineCurl` yet — the riding hunch rides on top; author curl per grab.
- Keyboard: `STICK_RATE` and `GRAB` in `src/input/keyboard.ts` once played.
