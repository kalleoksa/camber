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

## 4. Carried over

- Clothes phase 2: skinned lower body (pants bend at the knee instead of rigid tubes).
- Loose feel: step 1 (your tuning pass on the body springs) and step 3.
- `nosegrab`: the front knee goes ~10 cm through the deck in the authored pose (pose data).
- `npm run gate` fails `method path reach 1.0109` — on main too, predates the spine work.
- Halfpipe: wall-to-wall transfers untested by script; tune `HALFPIPE_*` and `WALL` in play.
- Anchors have no `spineCurl` yet — the riding hunch rides on top; author curl per grab.
- Keyboard: `STICK_RATE` and `GRAB` in `src/input/keyboard.ts` once played.
- Lipslide naming in the trick reader.
