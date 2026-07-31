# Design

Reference document for the sim model. Read with `CLAUDE.md`.

---

## 1. Conventions

- Units: metres, seconds, radians. Y is up. Board local: +Z nose, +X toe-side, +Y board up.
- `heading` = board yaw about terrain normal, radians.
- `edge` = signed −1..1. Negative = heel edge, positive = toe edge. 0 = flat base.
- `stance` = signed −1..1 weight along board. −1 = full tail, +1 = full nose.
- Regular stance assumed. Switch is `heading` 180° from velocity, not a separate mode.

---

## 2. Controls

Xbox-layout gamepad. Analog everywhere it matters.

| Input | Grounded | Airborne | Railed |
|---|---|---|---|
| Left stick X | Edge angle (target) | Spin rate about spin axis | Balance correction |
| Left stick Y | Stance: nose / tail press | Spin axis tilt → cork / off-axis | Nose / tail press shift |
| RT (analog) | Compress; **release = pop** | Absorb (prepare landing) | Compress; release = pop off |
| LT | Brake / heel scrub | — | — |
| Right stick | — | Grab select by direction; **hold = tweak** | — |
| LB / RB | Board pivot (revert, switch) | Shifty (board yaw independent of body) | Rotate slide angle |
| A | — | Bail / eject (manual) | — |
| Y | Reset to last drop-in | Reset | Reset |

**Grab directions on the right stick** (8-way, magnitude = tweak depth):

```
        nose (mute/nosegrab)
   \        |        /
 melon      |     indy
  (heel) ---+--- (toe)
   /        |        \
      tail (tail/stalefish)
```

Grab identity is a *hand target on the board* plus a *body pose bias*, not a clip.
Method = heel-edge grab + full tail stance + back arch. Emergent, not enumerated.

**Design note:** don't put trick names in the input layer. The player composes
edge + pop + spin axis + grab + stance. Naming happens in the feedback layer, if at all.

---

## 3. State machine

```
        ┌──────────────────────────────────────────────┐
        v                                              │
   ┌─────────┐  pop / lip / drop      ┌──────────┐     │
   │ GROUNDED│ ─────────────────────> │ AIRBORNE │     │
   │         │ <───────────────────── │          │     │
   └─────────┘   clean landing        └──────────┘     │
     │     ^                            │      │       │
     │     │ exit                       │      │ wall  │
     v     │                            v      v       │
   ┌─────────┐                     ┌────────┐ ┌──────┐ │
   │ RAILED  │ <────── attach ─────┘        │ │WALLED│ │
   └─────────┘                     │ BAILED │ └──────┘ │
        │  balance lost            └────────┘     │    │
        └──────────────────────────────>│ <───────┘    │
                                        │ recover ─────┘
```

Transition rules:

- **GROUNDED → AIRBORNE**: ground clearance > `air.detachClearance`, or pop released.
- **AIRBORNE → GROUNDED**: contact + landing test passes (§6).
- **AIRBORNE → BAILED**: landing test fails.
- **AIRBORNE/GROUNDED → RAILED**: board centre within `rail.captureRadius` of a spline
  point AND velocity-to-tangent angle < `rail.captureAngle`.
- **RAILED → AIRBORNE**: pop, spline end, or balance exceeded.
- **AIRBORNE/GROUNDED → WALLED**: contact with surface whose normal-to-up angle >
  `wall.minAngle` AND speed > `wall.minSpeed`.
- **BAILED → GROUNDED**: tumble settles, speed below threshold. Ragdoll here is fine —
  it's the one place the rider is no longer a controller.

Only one state active. Sub-state (grab held, press active) lives on `RiderState`, not in
the machine.

---

## 4. Ground model

Per tick, grounded:

1. **Contact.** Raycast down along gravity; get height, normal `n`, surface type.
   Board pitch/roll are *slaved to terrain normal*, smoothed by `ground.normalSmoothing`.
   Never solved from collision.
2. **Slope acceleration.** `a = g * (up × n × ...)` — the tangential component of gravity
   projected onto the contact plane.
3. **Decompose velocity** into board-forward `vf` and board-lateral `vl` using `heading`.
4. **Edge grip.** Lateral velocity is damped toward zero:
   `vl *= exp(-gripRate(|edge|) * dt)`, where `gripRate` ramps from `ground.gripFlat`
   (loose, skiddy) to `ground.gripEdge` (locked carve). This single curve is where
   carving lives — tune it before anything else.
5. **Carve rotation.** `heading += yawRate * dt`, with
   `yawRate = edge * ground.carveYaw * speedFactor(speed)`.
   `speedFactor` rises fast then plateaus, and is ~0 near standstill: **you cannot turn
   without speed.** Below `ground.pivotSpeed`, a separate low-authority skid-pivot is
   allowed so the player isn't stuck.
6. **Speed loss.** Base drag `-drag * v²`, plus edge drag proportional to `|edge| * |vl|`
   from step 4 — hard carves cost speed, which is what makes line choice matter.
7. **Stance effects.** `stance` shifts the effective pivot point along the board
   (nose press = pivot forward = tighter, twitchier turn), reduces grip, and above
   `butter.threshold` enters a butter press (§8).

---

## 5. Pop and air

**Charge.** RT held ramps `compress` 0→1 over `pop.chargeTime`, with visible knee bend.
Holding past full slowly bleeds it (`pop.decay`) — rewards timing, punishes camping.

**Release.** Impulse along the *contact normal*, not world up:
`v += n * (pop.base + pop.charged * compress)`. Ramp geometry adds its own velocity for
free, so kickers need no special case.

`stance` at release biases it: tail → ollie (more pop, nose-up rotation bias),
nose → nollie.

**Rotation.** Set at takeoff, modulated in air.

- Spin axis in board-local space, lerped by left stick Y at takeoff:
  stick centred → board up (flat spin); stick pushed → tilted toward board forward/right
  (cork, rodeo, misty come out of the same axis lerp — do not special-case them).
- `angularVelocity` set from stick X magnitude at takeoff.
- In flight, stick input applies torque at only `air.authority` (start at **0.35**) of
  ground-set magnitude. Enough to save a rotation, not enough to make takeoff irrelevant.
- Grab held → `air.tuckMultiplier` (~1.25) faster spin. Extended → slower. This is real
  and it's the main mid-air expression tool.

Never snap rotation mid-flight. Correction happens only at the landing test.

---

## 6. Landing test — the most important rule in the game

On contact from AIRBORNE, compute:

- `θ` = angle between board heading and velocity heading, both projected onto the contact
  plane, folded to nearest 180° (so switch landings are legal).
- `φ` = angle between board up and contact normal.

Then:

| Condition | Result |
|---|---|
| `θ < land.clean` AND `φ < land.rollClean` | **Clean.** Heading snapped to velocity. Full speed retained. |
| `θ < land.sketchy` | **Sketchy.** Heading snapped, speed penalty, hard absorb, rider wobble, audio scrape. |
| otherwise | **Bail.** Edge catch, ragdoll. |

Start with `land.clean = 25°`, `land.sketchy = 50°`.

This one rule generates, with no extra code: switch landings, revert saves, wash-outs,
over-rotation punishment, and the reason to spot your landing. Resist adding a separate
"rotation count" check — the angle test already contains it.

---

## 7. Rails

- Rails are catmull-rom splines in `park.json`, with a `width` and `type` (round/flat/tube).
- On attach, position is constrained to the spline; velocity keeps only its tangential
  component. Speed carried in ≈ speed carried through, minus `rail.friction`.
- **Slide angle** is board heading relative to spline tangent, held by the player:
  0° = 50-50, 90° = boardslide, plus `stance` offset for nose/tailslide. Continuous, not
  a menu — a 70° slide is a legitimate thing to be doing.
- **Balance** is a signed scalar drifting under seeded noise scaled by
  `rail.driftBase * (1 + |slideAngle|)` and by how far off-centre the stance is.
  Left stick X counters it. Exceeding `rail.balanceMax` → BAILED.
  Balance must be *winnable but never free* — that tension is the whole feature.
- Exit: pop (carries rail momentum + pop), ride off the end (retain state, re-enter
  AIRBORNE), or bail.

---

## 8. Wallrides and butters

**Wallride.** Contact normal steeper than `wall.minAngle` (~65°) and speed above
`wall.minSpeed` (~8 m/s). While WALLED, gravity is scaled to `wall.gravityScale` (~0.35)
and speed bleeds at `wall.drag`. Dropping below min speed slides you off downward, not a
bail. Board is slaved to the wall normal, so a wallride is visually just a very steep
carve — which is exactly what it is.

**Butter.** `|stance| > butter.threshold` while grounded and below `butter.maxSpeed`:
contact reduces to nose or tail point, grip drops to `butter.grip`, and yaw authority
rises sharply so ground 180s/360s are possible. Exit by re-centering. Nose press into a
pop is the entry to a nollie; keep those two systems composable.

---

## 9. Park format

```json
{
  "spawn": { "position": [0, 40, 0], "heading": 0 },
  "terrain": { "type": "slope", "length": 400, "width": 120, "pitch": 0.28 },
  "features": [
    { "type": "kicker", "position": [0, 0, -60], "heading": 0,
      "width": 8, "length": 12, "lipHeight": 2.4, "curve": 0.6 },
    { "type": "rail", "points": [[6,0.5,-90],[6,0.9,-100],[6,0.5,-110]],
      "diameter": 0.08, "railType": "round" },
    { "type": "wall", "position": [-14,0,-120], "heading": 0.4,
      "size": [16, 5, 0.5], "lean": 0.15 },
    { "type": "hip", "position": [20,0,-140], "heading": -0.5, "width": 10, "lipHeight": 3 }
  ]
}
```

All features are parametric primitives generated in code. No Blender round-trip, ever —
that's the whole point of the format. Adding a feature type means adding a generator
function, not an asset.

---

## 10. Feedback layer (the score replacement)

No numbers. Style is communicated through:

- **Audio, layered and continuous** — edge bite pitched by edge angle and speed, base
  chatter, wind by speed, ollie scrape, landing thump scaled by impact. This carries more
  feel information than the visuals do; treat it as a mechanic, not decoration.
- **Camera** — chase spring lag proportional to acceleration, FOV widening with speed,
  slight roll with edge angle, tighter framing while grabbed. Nothing sells a carve like
  camera roll.
- **Clean / sketchy read** — the landing test result expressed physically (rider wobble,
  spray burst, audio scrape) rather than as text.
- **Instant replay** — the reason the recorder exists in milestone 1. Free orbit camera
  on the last 8 seconds. This is the actual reward loop for a scoreless trick game.

Tweak-hold duration and landing cleanliness should visibly drive at least one of these.
Otherwise the game never tells the player they did something well.

---

## 11. Initial parameters

Starting values, not correct values. Every one is a Tweakpane binding.

```ts
export const params = {
  world: {
    gravity: 16.0,          // m/s² — above real 9.81 for snappier airtime
    terminalSpeed: 26.0,    // m/s
  },
  ground: {
    gripFlat: 0.8,          // 1/s lateral damping, flat base — skiddy
    gripEdge: 14.0,         // 1/s lateral damping, full edge — locked carve
    carveYaw: 2.6,          // rad/s at full edge, at plateau speed
    speedFactorKnee: 6.0,   // m/s where yaw authority reaches ~80%
    pivotSpeed: 2.5,        // m/s below which skid-pivot is allowed
    drag: 0.0016,           // quadratic, 1/m
    edgeDrag: 0.35,         // speed loss coefficient from carving
    normalSmoothing: 12.0,  // 1/s, board-to-terrain alignment rate
    edgeResponse: 9.0,      // 1/s, stick-to-edge-angle rate
  },
  pop: {
    chargeTime: 0.35,       // s to full compress
    decay: 0.4,             // 1/s bleed after full
    base: 2.0,              // m/s uncharged
    charged: 5.0,           // m/s added at full charge
    stanceBias: 0.3,        // ollie/nollie pop multiplier range
  },
  air: {
    detachClearance: 0.12,  // m
    authority: 0.35,        // 0..1 in-flight torque vs takeoff-set rotation
    tuckMultiplier: 1.25,   // spin rate while grabbed
    extendMultiplier: 0.85, // spin rate while stretched
    spinMax: 9.0,           // rad/s cap
    axisTiltMax: 1.1,       // rad, max cork axis lerp
  },
  land: {
    clean: 0.44,            // rad ≈ 25°
    sketchy: 0.87,          // rad ≈ 50°
    rollClean: 0.35,        // rad, board-up vs contact normal
    sketchySpeedLoss: 0.25, // fraction
    absorbTime: 0.22,       // s
  },
  rail: {
    captureRadius: 0.35,    // m
    captureAngle: 0.6,      // rad
    friction: 0.4,          // m/s² along spline
    driftBase: 0.9,         // balance drift rate
    balanceMax: 1.0,
    correctionGain: 2.2,
  },
  wall: {
    minAngle: 1.13,         // rad ≈ 65° from up
    minSpeed: 8.0,          // m/s
    gravityScale: 0.35,
    drag: 3.0,              // m/s² while walled
  },
  butter: {
    threshold: 0.65,        // |stance|
    maxSpeed: 12.0,         // m/s
    grip: 0.3,              // multiplier on gripEdge
    yawAuthority: 3.2,      // rad/s
  },
  camera: {
    springStiffness: 9.0,
    distance: 5.5,          // m
    height: 1.8,            // m
    fovBase: 62,            // deg
    fovSpeedGain: 0.5,      // deg per m/s
    rollGain: 0.18,         // rad per unit edge
  },
};
```

---

## 12. Open questions — resolve by playing, not by discussing

1. Is `air.authority` at 0.35 too punishing for a pad player? (Suspect 0.35–0.5.)
2. Should switch riding invert the edge mapping, or is heading-relative enough?
3. Does `speedFactorKnee` at 6 m/s make slow-speed riding feel dead?
4. Rail balance: noise-driven, or fully deterministic from entry angle? Deterministic is
   more learnable; noise is more tense. Try deterministic first.
5. Does a scoreless game need a "clean/sketchy" stamp at all, or is the physical read
   enough? Build without it, add only if the game feels mute.
