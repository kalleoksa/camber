# Design

Reference document for the sim model. Read with `CLAUDE.md`.

---

## 1. Conventions

- Units: metres, seconds, radians. Y is up. Board local: +Z nose, +Y board up, and +X is
  therefore `up × nose` — the **left** side of travel, which for a regular rider is the
  **heel** side. The toe side is −X. (This corrects an earlier line here that called +X
  the toe side: a right-handed frame with +Z nose and +Y up puts +X on the left of
  travel, which is a goofy rider, contradicting the regular stance assumed below.)
- `heading` = board yaw about terrain normal, radians.
- `edge` = signed −1..1. Negative = heel edge, positive = toe edge. 0 = flat base.
- `stance` = signed −1..1 weight along board. −1 = full tail, +1 = full nose.
- Regular stance assumed. Switch is `heading` 180° from velocity, not a separate mode.
- Sim math: `exp`, `log`, `pow`, `sin`, `cos`, `tan`, `acos`, `atan2` come from
  `src/sim/dmath.ts`, never `Math`. Engine versions differ in the last bit between ARM and
  x86 (a take recorded on an M-series Mac drifted in CI within seconds), and determinism
  has to hold across machines. `npm run check-math` enforces it in CI.

---

## 2. Controls

Xbox-layout gamepad. Analog everywhere it matters.

| Input | Grounded | Airborne | Railed |
|---|---|---|---|
| Left stick X | Edge angle (target) | Spin rate about spin axis | Weight shift (screen space): lean + contact |
| Left stick Y | Stance: nose / tail press | Flip (back = backflip); with X, cork | Weight shift (screen space): lean + contact |
| RT (analog) | Compress; **release = pop** | Absorb (prepare landing) | Compress; release = pop off |
| LT | Brake / heel scrub | — | — |
| Right stick | — | Grab: position on the board (§7.3); **push past the grab = tweak** | — |
| LB / RB | Board pivot (revert, switch) | Shifty (board yaw independent of body) | Rotate slide angle |
| A | — | Bail / eject (manual) | — |
| Y | Reset to last drop-in | Reset | Reset |

The right stick is a *continuous coordinate on the board*, not an 8-way selector — see
§7.3. Stick direction picks a point along the toe or heel edge; pushing past the point
where the hand catches starts tweaking. Grab identity is a hand target plus a body pose
bias, never a clip. Method = heel grab near mid-board + full tail stance + back arch +
deep tweak. Emergent, not enumerated.

**Riding switch.** Once you travel tail first (past `ground.switchSpeed`), the sticks
follow the direction of travel, not the board:

- Left stick X: right still turns right — on the heel edge, which is now the edge on your
  right. The edge, the lean and the camera roll are the board's real ones.
- Left stick Y: up presses the leading end (the tail), down the trailing end — so down is
  still the ollie and up still the nollie.
- Right stick: X is still toe (right) / heel (left); Y is the leading end (up) to the
  trailing end (down). A grab reached tail first is the switch version: the regular grab
  mirrored nose-for-tail — the leading hand takes it, and pose and board pitch mirror too
  (`grab.switchMirror`).

**Grabs by stick**, regular or switch. The named grab is the same stick either way; riding
switch you get its switch version (e.g. a switch method), done with the other hand:

| Grab | Hand | Right stick |
|---|---|---|
| Method | leading, heel edge, ahead of the front foot | up-left |
| Melon | leading, heel edge, between the feet | left, a touch up |
| Stalefish | trailing, heel edge, between the feet | left, a touch down |
| Mute | leading, toe edge | right, a touch up |
| Indy | trailing, toe edge | right, a touch down |
| Nose / tail | leading / trailing, the tip | up / down |

Push further past the grab to tweak it. **The same hand as your regular method while
riding switch** — the nose hand on the heel edge — is the trailing hand now: stick
down-left. It has no named anchor of its own there; you get a blend of stalefish and tail
grab, which is what that grab is.

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
   Because `yawRate` plateaus, turn radius grows with speed and lateral load grows with
   it — at the originally proposed `carveYaw` of 2.6 a 25 m/s carve implies about 6 g and
   the rider simply stalls, averaging 3 m/s through linked turns. Measured down to 1.0,
   which holds 15–20 m/s through full-edge turns. See open question 10.
6. **Speed loss.** Base drag `-drag * v²`, plus edge drag proportional to `|edge| * |vl|`
   from step 4 — hard carves cost speed, which is what makes line choice matter.
7. **Stance effects.** `stance` shifts the effective pivot point along the board
   (nose press = pivot forward = tighter, twitchier turn), reduces grip, and above
   `butter.threshold` enters a butter press (§9).

---

## 5. Pop and air

**Charge.** RT held ramps `compress` 0→1 over `pop.chargeTime`, with visible knee bend.
Holding past full slowly bleeds it (`pop.decay`) — rewards timing, punishes camping.

**Release.** Impulse along the *contact normal*, not world up:
`v += n * (pop.base + pop.charged * compress)`. Ramp geometry adds its own velocity for
free, so kickers need no special case.

`stance` at release biases it: tail → ollie (more pop, nose-up rotation bias),
nose → nollie.

**Rotation.** Set at takeoff, modulated in air. Rotation lives on `spinFrame`, which
carries angular momentum and is the *clean* board orientation. What gets drawn is
`spinFrame ∘ tweakOffset` (§7.4) — the two are not the same thing and must never be
welded together.

- Spin axis in board-local space, lerped by left stick Y at takeoff:
  stick centred → board up (flat spin); stick pushed → tilted toward board forward/right
  (cork, rodeo, misty come out of the same axis lerp — do not special-case them).
- `angularVelocity` set at takeoff from **how far stick X has been whipped past the carve
  already being held**, not from its absolute position. Left stick X is the edge stick
  grounded and the spin stick airborne, and the pop is the seam between the two — read the
  position raw and a hard carve *is* a request for a 360 whether the rider wanted one or
  not, which is exactly what it did. `state.spinRef` follows the stick at
  `air.spinRefRate` and takeoff measures against that, so a steady thumb pops straight and
  a deliberate whip spins. `air.spinCarveReject` at 0 restores the raw-position read.
  Two consequences worth knowing, both symmetric and both intended: how long you hold the
  whip before releasing RT meters the rotation down (full whip → 360 released immediately,
  ~180 after 150 ms, ~0 after 500 ms), and relaxing the stick to centre out of a hard carve
  and popping *immediately* is itself a full whip, so it spins you the other way. Settle
  for `spinRefRate`'s time constant first if you want the straight air.
- In flight, **stick position means the same thing it did at takeoff: spin speed.** It
  pulls the rate toward `stickX * air.spinTakeoff` at `air.authority` per second, so a
  short air cannot fully retarget and takeoff still decides where you start. A centred
  stick coasts — that is how you hold a rotation you already have.
  This resolves open question 1, by play: `air.authority` as a 0..1 fraction of a
  *different* scale (`spinMax`) made spin uncontrollable. Every landing came out at
  whatever the stick happened to be at on release, and since full stick saturated near
  360° that was the only repeatable trick — a 180 needed the stick inside a ~6% band you
  cannot see. One consistent scale plus a real response rate makes the whole range
  reachable: half whip is a 180, full whip is a 360, and mid-air stick moves it.
  In-air spin control is **disarmed until the stick comes back inside `air.spinArmBand`**.
  Leaving the ground mid-carve the thumb is still buried where the carve put it, and
  without the latch the air controller spends the whole air dragging the rate up to the
  carve's value — measured at 146° of unrequested rotation off an otherwise straight pop,
  enough to undo the takeoff fix on its own. Once armed, the law above applies unchanged.
- **Checking the spin.** (Once armed: a disarmed spin coasts, neither steered nor checked.) Two recorded takes showed every spin under-rotated: with a
  centred stick coasting, rotation was air time × stick rate and nothing else, so a 360
  existed only on a full-charge pop (0.92 s of air) and typical 0.7–0.84 s airs came up
  30–90° short with no way to recover. Now a centred stick *checks* the spin at
  `air.checkRate` (leftover ≈ rate / checkRate), and `air.spinTakeoff` is raised to 9 so
  full stick overspins and the player opens up to spot the landing — a 360 lands from
  ~0.70 s of air, a 180 from ~0.6 s. Holding the stick still holds the spin; holding it
  to contact overspins. `air.takeoffWindow` (0.1 s) lets a stick that arrives just after
  the trigger still count as the wind-up; it only ever strengthens the spin. Both new
  params at 0 restore the old coast.
- **Levelling moves the whole rotation.** In flight the takeoff surface's up (`airUp`)
  is rotated toward the ground below at `air.levelRate`, and the board with it, as one
  rigid rotation. A full spin about any axis returns the board to its takeoff attitude, so
  correcting that attitude lands flat spins *and* corks on the landing's angle without
  ever fighting the spin. The first version levelled board up and had to switch off for
  corks; a recorded cork 360 off the kicker, 6° from a full turn, then landed 42° nose-high
  (the lip-to-landing angle) and sketchy. It lands clean under this rule.
- **Flips: the stick is a rotation, not a rate plus a tilt.** At the pop the stick sets
  a board-local rotation vector: X spins about board up (`air.spinTakeoff`), Y — past the
  cork deadzone — flips about the board's lateral, toe–heel axis (`air.flipRate`): across
  the direction of travel, so on a backflip the nose comes up and over toward the tail.
  Stick back, the tail press, is a backflip. (The first version flipped about the board's
  length, which played as a barrel roll.)
  The axis is the vector's direction and the rate its length, so sideways is a flat spin,
  straight back or forward a flip, a diagonal a cork, and a diagonal held long enough a
  double cork — one rule, as this section always asked. The older rule (X sets the rate,
  Y only tilts the axis, capped at `axisTiltMax`) made a straight flip unreachable; takes
  recorded under it replay with `flipRate` 0. In the air the stick is read against the
  current axis: held it holds the rotation, eased it slows it, it can't swing the axis.
  Opening up (Y centred) unwinds only the flip part, leaving the spin part as it was, and
  rights the board only when it is already within `air.corkRightMax` of the ground — so a
  flip let go upside down does not land itself, and flips need timing where corks forgive.
- **Coming out of a cork.** A spin about a fixed tilted axis only returns the board
  upright after whole turns; at any half turn — a cork 180 or 540 landing fakie — it is
  tipped over by twice the tilt, so those were impossible. Riders go off axis and then
  open up. Holding stick Y keeps the cork, as holding X keeps the spin; centring it
  swings the spin axis back to board up and rights the board toward the ground below at
  `air.corkRecover`, the spin untouched. A cork 540 now lands fakie if you come out in
  time, and bails if you don't.
- **Cork deadzone.** Stick Y at takeoff is also the tail press, so |Y| under
  `air.corkDeadzone` (0.5) is a flat spin; past it the tilt rescales to the full cork.
  Found on a recorded 720 off the kicker: a thumb pressing tail at −0.41 while throwing
  the spin had tilted the axis 26°, which also switched off in-air levelling, and the
  board came down 28° off the landing — sketchy on a spin that was 4° from perfect.
- **Only a pop sets rotation.** Riding off a lip without popping carries the carve's
  yaw rate onto a flat axis; the stick does not launch a spin nobody wound up, and the
  spin starts disarmed if the thumb is still in the carve.
- **Shifty** (LB/RB) yaws the board under the body toward ±`air.shiftyMax` at
  `air.shiftyRate`. Drawn board and landing test are `spinFrame ∘ shifty ∘ tweakOffset`,
  so a shifty held into contact is judged like any other off-axis board.
  The same rule means a small shifty at contact can *save* a slightly over- or
  under-rotated spin by bringing the board back onto the direction of travel.
  Decided by play: keep it — it's how a real rider saves a landing. The lever if it
  ever gets too forgiving is `air.shiftyMax`, not a special case in the landing test.
- Grab held → `air.tuckMultiplier` (~1.25) faster spin. Extended → slower. This is real
  and it's the main mid-air expression tool.

Never snap rotation mid-flight. Correction happens only at the landing test.

---

## 6. Landing test — the most important rule in the game

On contact from AIRBORNE, compute — from the **composed** board orientation
`spinFrame ∘ tweakOffset`, not from `spinFrame` alone:

- `θ` = angle between board heading and velocity heading, both projected onto the contact
  plane, folded to nearest 180° (so switch landings are legal).
- `φ` = angle between board up and contact normal.

Then:

| Condition | Result |
|---|---|
| `θ < land.clean` AND `φ < land.rollClean` | **Clean.** Heading pulled onto velocity. Full speed retained. |
| `θ < land.sketchy` AND `φ < land.rollSketchy` | **Sketchy.** Heading snapped, speed penalty, hard absorb, rider wobble, audio scrape. |
| otherwise | **Bail.** Edge catch, ragdoll. |

Start with `land.clean = 25°`, `land.sketchy = 50°`, `land.rollSketchy = 50°`. Without
the roll bound on the sketchy row, a board that comes down upside down but pointing the
right way survives.

Board heading at contact is read from the composed orientation, not carried over from
takeoff. Carrying it over judges a 180 correctly and then rebuilds it riding forward.

The heading correction is *converged* at `land.headingSnap` over the absorb window, not
teleported. An instant snap of up to `land.sketchy` makes every landing come out at an
exact multiple of 180°, which reads as the game rounding your trick off for you rather
than as you riding out of it.

This one rule generates, with no extra code: switch landings, revert saves, wash-outs,
over-rotation punishment, and the reason to spot your landing. Resist adding a separate
"rotation count" check — the angle test already contains it.

Reading the composed orientation is what turns tweak depth into a real wager: a method
still hanging 60° off axis at contact fails both `θ` and `φ` and catches an edge. Hold
it for style, pull it back in time, or eat it. That is the scoreless feedback problem
from §11 solved in the physics instead of in a UI element — do not also stamp it on
screen.

**Impact as a third test** (built; older takes replay with it off). Judged on angles
alone, an 18 m/s slam into the landing past a kicker's end read clean if the board lined
up. The speed into the surface, `impact = |v·n|` at contact, is now a third input:

| Impact | Result |
|---|---|
| `impact < land.impactSketchy` | no change — the angles decide |
| `< land.impactBail` | at best **sketchy**: knees buckle, speed penalty |
| otherwise | **bail**, however well the board lines up |

Absorb raises both limits: holding RT in the air (the airborne "absorb" in §2) as you come
down scales them by `land.absorbGain`, so a big drop to flat is survivable if you prepare
for it — a legs-bent landing, not a stiff one. Starting points from the probes: clean park
landings run 5–12 m/s, the overshoot that prompted this was 18, so roughly
`impactSketchy` 13 and `impactBail` 17. The research (equivalent fall height, §10 notes)
puts a real rider's comfortable limit near 1.5 m of fall — at the sim's gravity about
7 m/s — but the game's airs are bigger than real ones, so start from play, not from that.
As built, `absorbGain` is 0.25. Probe, dropping flat onto the slope at 10 m/s along it:
4 m clean (11 m/s), 8 m sketchy (15.5), 10 m and up bail. Absorbed, 10–16 m is sketchy
and 20 m still bails. Sochi landings stay clean (5–12 m/s); overshooting the corner to its
deck (14.4) is sketchy.
Walls and the quarter pipe are judged the same way; a wallride entry is not a landing.

---

## 7. The rider rig

### 7.1 Inverted from the standard character rig

Normal character animation: hips drive, feet IK to the ground. Here it is backwards.
**The feet are bolted to the bindings and are the constraint. The hips are the only
thing that moves.** Everything else falls out of that.

Almost the entire vocabulary is *where the hips sit relative to the board*:

| Hip offset | Reads as |
|---|---|
| Down along board normal | Crouch / compression |
| Lateral toward toe or heel | Edge lean |
| Forward / back along board length | Nose or tail press |
| Yaw relative to board | Counter-rotation, spin wind-up |

### 7.2 The driver vector

The whole rider is about twenty numbers. Small enough to bind every one to Tweakpane,
which is the point — see §7.8. It is twenty-three now: 21–23 below were each added
because a pose the rig was supposed to reach turned out to be unreachable without them.
Every one was found the same way: by measuring a pose against `grabs.md` and finding no
value of the existing drivers that satisfied it.

`boardBack` is the one worth learning from. Its absence looked like a *proportions* problem
— the arm measured 4% too short to make a method at anatomically correct knee flexion, and
lengthening it did fix the numbers. But the real cause was that the board could not go
behind the rider, so the torso had to lean over to reach it. Once `boardBack` existed the
arm went back to 0.66 m and the pose came out inside every band. A missing degree of
freedom impersonates a wrong constant.

| # | Driver | Space / range |
|---|---|---|
| 1–3 | Hip offset | board-local metres (x toe+, y board-up, z nose+) |
| 4–6 | Hip rotation: yaw, pitch, roll | rad, relative to board |
| 7–9 | Spine: bend, side-bend, twist | rad |
| 10–11 | Front hand target: `edge`, `t` | −1..1, 0..1 |
| 12–13 | Back hand target: `edge`, `t` | −1..1, 0..1 |
| 14–15 | Hand attachment, per hand | 0 = rest pose, 1 = locked to board |
| 16 | Tweak depth | 0..1 |
| 17–18 | Head look-at: yaw, pitch | rad, world-relative |
| 19 | Knee pole splay | rad, swept from the toe side. **Past π/2 the knees break backward** — a method needs that, and the slider used to stop at 1.4 so it was unreachable |
| 20 | Stance width scale | multiplier on binding separation |
| 21 | Board lift | m the board rises toward the rider along its own normal — the leg tuck. Without it a grab is only reachable by folding the torso double |
| 22 | Board back | m the board travels toward the heel side, **behind the rider's back**. Lift alone could only raise it, so the only way onto the heel edge was to lean the torso 57° over to meet it — which is a fold, not a method. It is also the melon/method discriminator: board under the rider versus behind them |
| 23 | Free arm raise | 0 at the side, 1 at ~155° shoulder flexion. A method's trailing arm is a counterweight thrown skyward and the rest pose pinned it down |

**Head pitch is about board Z, not board X.** The rider faces −X, so X is their *facing*
axis and a rotation about it rolls the head ear-to-shoulder. Neck extension — looking up
and back — needs Z. `hipPitch` and `hipRoll` still have this backwards: `hipPitch` rotates
about X, which for the rider is a roll, and `hipRoll` about Z, which is a pitch. They are
named in the board's frame and authored in the rider's, and the two disagree.

**Known unreachable, from `grabs.md`:**

- **`armRouting`** — `outside` | `betweenLegs` | `crossed`. The same `(hand, edge, t)` on a
  different arm path is a different trick: roast beef and stalefish grab nearly the same
  spot. The elbow pole is currently a fixed toe-side vector, so every routing is `outside`,
  and a melon's arm will happily pass *in front* of the front leg, which is anatomically
  impossible at that `t`.
- **`boneMap`** — which leg extends, `front` | `back` | `both` | `neither`. "Boned" means
  extended, and per `grabs.md` this is where most of the perceived style lives. `kneeSplay`
  is one driver shared by both legs, so a boned indy — front leg pushed straight while the
  back stays tucked — cannot be posed at all.

**Sim owns**, because it feeds the landing test or the physics: `spinFrame`,
`tweakOffset`, the active grab (`edge`, `t`, which hand, attached), `compress`, `stance`,
`edge`. **Render owns** everything else — hip springs, spine, arms, head, all IK. The
rig is a pure function of sim state plus its own spring memory, and it stays on the
render side of invariant 5.

### 7.3 Grabs are a 2D coordinate, not eight buttons

This supersedes the 8-way diagram that used to be in §2.

Two splines run along the board, one per edge, parameterised `t` from tail (0) to nose
(1). A grab is `(edge, t, whichHand)` — **incomplete**, see `grabs.md` §1: it needs
`armRouting` as a fourth parameter, and `boneMap` on the tweak side.

**The strongest argument for this whole architecture:** a method and a melon are the *same
grab*. Front hand, heel edge, `t` ≈ 0.5, identical coordinate. Everything that separates
them happens after the hand lands — spine extension, board behind rather than under. That
is why the grab spline and the driver vector have to be separate systems, and why trick
names must never appear in the input layer.

**The arm is a tension member, never an actuator.** Once anchored, the hand does not lift
the board; the legs push the board away against the anchored hand. Board orientation is
the *effect*, knee and hip action the *cause*. Implemented the other way round the poses
come out geometrically correct and read as dead.

**The centre of mass stays on its parabola.** If tucking the legs swings the board back,
the hips move forward by the mass-weighted equivalent. This single constraint generates
most of what reads as authentic, including the arch in a method, which is largely
counter-rotation of 15–25° against the board rather than decoration. A pose that moves the
COM is wrong even when the silhouette looks right.

Note that `grabs.md`'s data block uses the **opposite sign convention for `spineBend`** —
there `+` is extension (arch), in the rig `+` folds the chest toward the toes. Its method
value of `+0.92` is this rig's `−0.92`. The right stick maps continuously into that
space: stick X → edge, stick Y → `t`.

| Grab | Hand | Edge | `t` |
|---|---|---|---|
| Indy | back | toe | ≈0.35 |
| Mute | front | toe | ≈0.55 |
| Melon | front | heel | ≈0.50 |
| Stalefish | back | heel | ≈0.30 |
| Nose | front | either | ≈0.90 |
| Tail | back | either | ≈0.05 |

The player can sit *between* named grabs, which is true to riding — nobody thinks "I'll
do a mute", they reach for a spot on the board and someone names it afterward. Names go
in the replay layer if anywhere, never in the input layer.

**Hand selection falls out of `t`**, it is not a separate input: whichever hand can
reach. Take the midpoint between the bindings as the split — `t` below it is the back
hand, above it the front hand. Indy and mute are then the same edge and the same stick
direction at different depths, which is exactly right. Crossed grabs (crail, roast beef)
need the *other* hand and have no natural mapping yet — see §13.

### 7.4 The tweak: board visual ≠ board physics

This is the part most implementations get wrong.

A tweak is not the hand moving. The hand is **locked** to the board. A tweak is the
rider shoving the board away with their legs while holding on, so the board rotates
*about the grabbed point*.

```
boardOrientation = spinFrame ∘ tweakOffset
```

`spinFrame` carries angular momentum and is what rotation tracking reads. `tweakOffset`
is a player-driven rotation about the active grab point. A method air is the board
yanked 60°+ off axis behind the rider, and that is simply not expressible if the two are
welded together.

Two consequences that are easy to get wrong:

- **The hips hang off `spinFrame`, not off the drawn board.** If the hips are parented
  to the tweaked board, the whole rider rotates with it and the tweak becomes invisible.
  The hip target is expressed in the *clean* frame; the feet follow the *tweaked* board;
  the legs stretch across the difference. That is what a tweak physically is.
- **Leg reach clamps tweak depth for free.** The two-bone IK cannot exceed
  `thigh + shin`, so how far the board can be shoved out is limited by the geometry
  rather than by a tuned maximum. Clamp `tweakOffset` to whatever keeps both feet
  reachable and let the anatomy be the limit.

**In play the sim owns the board's attitude.** Each grab's pitch and roll live in
`params.grab` (`methodPitch`, `methodRoll`, …) and `src/sim/grabs.ts` blends them over the
grab spots, so the landing test composes `spinFrame ∘ shifty ∘ pitch ∘ roll` from the same
numbers the rig draws. The anchors supply the body; pose mode's "write to anchor" copies an
anchor's `boardPitch`/`tweakRoll` into those params.

**Recovery is automatic.** Release the right stick and `tweakOffset` springs to zero at
`grab.tweakRecover`, roughly 70 ms at the starting value. Decided, not open: requiring a
deliberate pull-back through centre is more expressive but makes a dropped stick a bail,
which reads as unfair on a pad. So the wager the landing test creates (§6) is *did you
let go in time*, not *can you fly it back by hand*. That still bites on a late grab —
70 ms of spring plus reaction time is real airtime — while a panic release always saves
you. If it turns out to be free, `grab.tweakRecover` is the number to lower, and scaling
recovery rate with depth is the fallback if a flat rate can't be made to bite.

Legs and arms are 2-bone chains. Law of cosines, roughly twenty lines. Do not reach for
CCD or FABRIK on a 2-bone chain.

```
d      = clamp(|target − hip|, |thigh − shin| + ε, thigh + shin − ε)
kneeθ  = acos((thigh² + shin² − d²) / (2·thigh·shin))
hipθ   = acos((thigh² + d²    − shin²) / (2·thigh·d))
```

Knee bend **emerges**. You never author a knee angle — crouch is a hip offset and the
knee is a consequence. Point the knee pole vector forward-and-outward: a snowboard
stance splays the knees, it does not squat straight.

### 7.6 Springs everywhere, targets never assigned directly

Every driver is a critically-damped spring toward a target. Never a direct write. One
mechanism then generates:

- **Landing absorb** — shove hip height down hard on impact, let it recover
- **Pop** — release the spring upward
- **Terrain chatter** — inject small noise into the same spring
- **Weight in turns** — lateral hip spring lags the edge input
- **Counter-rotation unwind** — see §7.7

Four tunables total per driver group, and really only two that matter: `ω` (stiffness)
and `ζ` (damping ratio, default 1.0 — go below it only where you want an overshoot you
can name). Highest feel-per-line-of-code in the whole rig.

Semi-implicit integration, stable at 120 Hz:

```
a = ω² · (target − x) − 2·ζ·ω·v
v += a · dt
x += v · dt
```

Any spring that feeds `tweakOffset` runs in the sim at the fixed tick, because the
landing test reads it. The rest run render-side.

### 7.7 Counter-rotation is the biggest realism cue

Riders wind up before spinning: shoulders and hips rotate *against* the intended
direction during compression, then unwind at pop.

- During RT charge with the stick pushed toward a spin, wind spine twist opposite.
- At release, unwind — this is what visually explains where the rotation came from.
- In air, shoulders lead the board by a small phase offset.
- The head snaps toward the landing **before** the body does.

Head look-at is wildly underrated and nearly free. The rider watches the lip, then the
landing, then the fall line.

### 7.8 Build order

1. **Box rider first.** Capsules and boxes, no mesh. The rig is joint transforms; the
   skin is a separate problem, solved later by swapping in a humanoid and writing bone
   quaternions directly. Never touch `AnimationMixer`.
2. **Pose mode before gameplay mode.** Tweakpane sliders on all twenty drivers with
   gameplay disconnected. Pose the rider by hand.
3. **Author anchor poses in driver space.** A good method, a good indy, a deep crouch —
   named presets of those twenty numbers, which gameplay then interpolates.

Step 3 is not smuggling keyframes back in past invariant 3. A keyframed trick clip is a
skeleton animation selected by button combo; this is a twenty-value driver vector that
stays fully composable — you can be 60% of the way to the method anchor while spinning
and pressing tail, and it still resolves. If an anchor ever needs a *timeline*, that is
the invariant breaking and it should be caught in review.

**Per-frame order matters:** board visual transform (with tweak) → feet → hips → spine →
arms → legs. Legs solve last because the feet follow the tweaked board and the hips do
not.

---

## 8. Rails

- Rails are polylines of straight segments (`rails` in the slope config, carried by the
  take), points as (x, height above snow, z). Curves from short segments until M7 needs
  splines.
- On attach, position is constrained to the rail; velocity keeps only its tangential
  component. Speed then follows gravity along the rail minus `rail.friction`, scaled up by
  `rail.slideFriction` the further the board is turned across.
- Capture: within `rail.captureRadius`, travelling within `rail.captureAngle` of the rail
  line, not rising faster than `rail.captureRise` of speed. From air or snow.
- **Slide angle** starts from how the board met the rail; LB/RB turn it at
  `rail.slideRate`. 0 = 50-50, ±π/2 = boardslide, stance press = nose/tailslide.
  Continuous, not a menu.
- **Balance** is deterministic, no noise: an unstable lean
  `b'' = λb − c·b' + rail.correctionGain·lx`, with
  `λ = rail.instability·(1 + rail.slideDrift·|sin slide| + rail.pressDrift·|stance|)`.
  The entry seeds it — lateral miss (`rail.entryOffsetGain`), sideways speed
  (`rail.entryVelGain`), never less than `rail.minImbalance`. `|b| > rail.balanceMax` → BAILED.
  Winnable but never free: hands off falls in ~1.2–1.6 s.
- **Trick model** (`rail.trickModel` 1; takes before it replay with 0, the model above).
  Presses and slides come from where the weight sits, not from spinning:
  - The left stick is a weight shift in screen space (X toward the rail's side, Y toward
    travel), split onto the board by the slide angle. So a 50-50, a boardslide and
    riding switch all read the same way on the stick.
  - Across the board it fights the **lean over the edges** (`balance`, + heel):
    `b'' = λb − c·b' + correctionGain·w_heel + rail.slidePull·sin slide`, with `|contact|`
    in place of `|stance|` in λ. The slide term is the rail grabbing the board while the
    body keeps going: a boardslide pitches you toward travel, and holding it takes a steady
    push back.
  - Along the board it moves the **contact point** (−1 tail … +1 nose), a damped spring
    (`rail.pressStiffness`, `rail.pressDamping`) toward `rail.pressMax·w_along`. Past
    `rail.pressTip` the end outweighs you (`rail.tipInstability`) and must be fought back;
    `|contact| ≥ 1` slips off that end → BAILED. A nose press is a 50-50 with the contact
    forward; a noseslide is a boardslide with it forward.
  - Capture seeds the contact from where along the board the rail was met and the lean
    from the miss across it; sideways speed starts both moving.
  - The board sits with its contact point over the rail. Render tips it onto that point
    (`rig.pressPitch`) and puts the hips over it (`rig.pressHipShift`).
  - LB/RB still turn the slide angle, now slowly (`rail.slideRate` 2): the way into a
    boardslide is an ollie turned 90° onto the rail. Capture takes the slide angle from the
    board, and a quick flick after the pop lands 45–120° across (probe).
- **Slide poses** (render, `poses.ts`): anchors blended by how far across the rail the
  board is and by the contact point, with the balance lean on top.
  - `backsideBoardslide`: travelling toward the toes (open). Your pose: folded over the
    toes, hips rolled, lead arm out along the rail.
  - `frontsideBoardslide`: travelling toward the heels (blind). Your pose: shoulders opened,
    head turned right round, upright.
  - `press`: chest and front hand over the pressed end, mirrored for the tail.
  - A slide anchor's `shifty` means the body turned against the board. In play the sim
    owns the board, so it is applied as hip yaw.
- **Names**, as read from the state (no score). Board across the rail, travelling toward
  the heels (blind) = **frontside boardslide**; toward the toes (open) = **backside
  boardslide** — your convention. Along the rail with the contact at an end = nose or tail
  press; across with the contact at an end = nose or tail slide. Lipslides (approached so
  the tail crosses the rail first) are still to name.

---

## 9. Wallrides and butters

**Wallride.** Contact normal steeper than `wall.minAngle` (~65°) and speed above
`wall.minSpeed` (~8 m/s). While WALLED, gravity is scaled to `wall.gravityScale` (~0.35)
and speed bleeds at `wall.drag`. Dropping below min speed slides you off downward, not a
bail. Board is slaved to the wall normal, so a wallride is visually just a very steep
carve — which is exactly what it is. As built: WALLED runs the grounded step with those
two changes. Entry needs the smoothed ground normal still gentle — the face arriving under
the board — so a wall that has let go doesn't re-grab while you slide back down it. Walls
are terrain (`walls` in the slope config): transition arc, straight face at `angle`, flat
top, back face, ends faded in; their surface reads as `wall`. Popping on a wall's
transition on the way in (steeper than `wall.popAngle`, not yet walled) while heading up or
along it drives you up the face by `wall.popScale` of the pop instead of launching you off
it; once walled, a pop is an ordinary air off the face, along its normal, and flying into a face
fast enough sticks — only the heading angle is judged, since the board is slaved to it.

**Butter.** `|stance| > butter.press` while grounded and below `butter.maxSpeed` (faded in
over `butter.speedFade`): grip scales by `butter.gripScale`, the carve stops handing scrub
back to forward speed, and the edge stick pivots the board at `butter.yawRate`,
independent of speed — so a ground 180/360 turns the board, not the rider's path. Render
tips the board onto the pressed end by `butter.pitch`. Exit by re-centering. Nose press
into a pop is the entry to a nollie; the pop's stance bias already composes with it.

---

## 10. Park format

**Stand-in until milestone 7:** one table-top in `SlopeConfig.kicker` (main.ts), built into
the heightfield — circular transition to the lip, flat deck, landing ramp. **Sidelines are landable, and that is intended** (decided by play). The landing test
reads the contact normal wherever the board touches down, so the kicker's side taper — up
to ~36° across — lands clean when the board matches it: a recorded 695° came down 7.4 m
off centre on the side slope, clean. Keep the sides as a slope, not a wall, and don't
special-case "off the landing" in the test.

Two things it
needed in the sim: grounded detaches when the surface turns away under the board
(`air.detachSpeed`), or the deck catches the rider at the lip every tick; and in flight the
board's pitch/roll relax toward the ground beneath (`air.levelRate`), or every straight air
lands nose-high off the lip's angle. It is now a park table-top: circular takeoff to a 5.5 m lip, flat deck, rounded knuckle,
a straight landing 0.3 rad below the slope (~33° absolute), rounded run-out. Sized by
simulation at the 10–12 m/s you arrive with 10 m below spawn — the old 30 m placement gave
18–22 m/s, which no park-sized landing can catch. Straight rolls land at ~3 m/s of impact.
Popped airs still come in around 9 m/s: the pop adds ~7 m/s of lift, far more than an ollie
off a real lip, so `pop.charged` is the lever there, not the landing.

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

## 11. Feedback layer (the score replacement)

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

## 12. Initial parameters

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
    carveYaw: 1.0,          // rad/s at full edge, at plateau speed (was 2.6, see §4)
    speedFactorKnee: 6.0,   // m/s where yaw authority reaches ~80%
    pivotSpeed: 2.5,        // m/s below which skid-pivot is allowed
    drag: 0.0016,           // quadratic, 1/m
    edgeDrag: 0.35,         // speed loss coefficient from carving
    normalSmoothing: 12.0,  // 1/s, board-to-terrain alignment rate
    edgeResponse: 9.0,      // 1/s, stick-to-edge-angle rate
  },
  pop: {
    chargeTime: 0.25,       // s to full compress
    decay: 0.4,             // 1/s bleed after full
    base: 2.0,              // m/s uncharged
    charged: 5.0,           // m/s added at full charge
    stanceBias: 0.3,        // ollie/nollie pop multiplier range
    trigger: 0.15,          // RT above this counts as held; below it releases
  },
  air: {
    detachClearance: 0.12,  // m
    authority: 1.2,         // 1/s, how fast in-air stick pulls spin toward its target
    tuckMultiplier: 1.25,   // spin rate while grabbed
    extendMultiplier: 0.85, // spin rate while stretched
    spinMax: 9.0,           // rad/s cap
    axisTiltMax: 1.1,       // rad, max cork axis lerp
    spinTakeoff: 9.0,       // rad/s at full stick on takeoff (was 7, see §5)
    takeoffWindow: 0.1,     // s after a pop the stick still counts as takeoff
    checkRate: 6.0,         // 1/s, spin decay with the stick centred; 0 = coast
  },
  land: {
    clean: 0.44,            // rad ≈ 25°
    sketchy: 0.87,          // rad ≈ 50°
    rollClean: 0.35,        // rad, board-up vs contact normal
    rollSketchy: 0.87,      // rad ≈ 50°, roll past which even a straight board bails
    sketchySpeedLoss: 0.25, // fraction
    absorbTime: 0.22,       // s
    headingSnap: 18.0,      // 1/s, heading correction onto velocity
  },
  bail: {
    drag: 16.0,             // m/s² while tumbling
    recoverSpeed: 2.5,      // m/s below which the rider gets back up
    minTime: 0.9,           // s before recovery is allowed
    tumbleRate: 8.0,        // rad/s, visual tumble
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
  grab: {
    commit: 0.35,           // right-stick magnitude past which the hand reaches
    edgeSharpness: 2.0,     // stick X gain onto the edge coordinate
    reachTime: 0.12,        // s, hand travel to the board once the stick commits
    releaseTime: 0.09,      // s, hand back to rest
    tweakEnter: 0.55,       // stick magnitude past which the tweak starts
    tweakDepthMax: 1.15,    // rad of board rotation about the grab point at full push
    tweakRate: 10.0,        // 1/s, board shoved out toward the stick's depth
    tweakRecover: 14.0,     // 1/s, board springs back to spinFrame on release
  },
  rig: {
    thigh: 0.44,            // m
    shin: 0.44,             // m
    upperArm: 0.33,         // m
    forearm: 0.33,          // m, to the grip rather than the wrist
    stanceWidth: 0.52,      // m between bindings
    hipHeight: 0.86,        // m above the deck, uncompressed
    kneeSplay: 0.5,         // rad, pole vector out from forward
    hipStiffness: 9.5,      // ω rad/s, vertical and lateral hip spring (90 was ω²)
    hipDamping: 1.0,        // ζ, 1.0 = critically damped
    spineStiffness: 7.4,    // ω rad/s (55 was ω²)
    spineDamping: 1.0,      // ζ
    counterRotation: 0.7,   // rad of spine twist against a wound-up spin at full charge
    shoulderLead: 0.25,     // rad, shoulders ahead of the board in flight
    headLead: 0.18,         // s, head reaches the landing before the body
    absorbImpulse: 0.35,    // m of hip drop per unit of landing impact
    chatterGain: 0.012,     // m of hip noise per m/s over rough snow
  },
  spray: {
    rate: 900,              // particles/s at full scrub
    scrubRef: 18.0,         // m/s² of edge scrub that saturates emission
    life: 0.5,              // s
    launch: 3.4,            // m/s away from the edge
    spread: 2.2,            // m/s random scatter
    rise: 1.6,              // m/s upward bias
    size: 0.16,             // m
    gravity: 6.0,           // m/s²
  },
  audio: {
    master: 0.55,
    edgeGain: 0.5,          // edge bite at full scrub
    edgeFilterBase: 380,    // Hz at a standstill
    edgeFilterGain: 95,     // Hz per m/s
    edgeQ: 4.0,
    baseGain: 0.22,         // base chatter on snow
    baseFilter: 700,        // Hz lowpass
    windGain: 0.4,
    windSpeedRef: 22.0,     // m/s where wind is full
    thumpGain: 0.7,         // landing thump at full impact
    thumpRef: 12.0,         // m/s of normal impact that saturates it
    thumpFilter: 220,       // Hz lowpass — a thud, not a crack
    thumpDecay: 0.28,       // s
  },
  camera: {
    springStiffness: 9.0,
    distance: 5.5,          // m
    height: 1.8,            // m
    fovBase: 62,            // deg
    fovSpeedGain: 0.5,      // deg per m/s
    rollGain: 0.18,         // rad per unit edge
    followSpeed: 3.0,       // m/s above which the camera follows travel, not the board
  },
};
```

`rig.*` are render-side and do not affect the sim hash — except `grab.*`, which does,
because `tweakOffset` reaches the landing test.

---

## Milestone status

| # | Milestone | Status |
|---|---|---|
| 1 | Harness | Gate passed — real takes replay bit-identically, across machines since `dmath` |
| 2 | Carving | Gate passed |
| 3 | Air | Gate passed 2026-09 — spins with check, corks, flips, landing tolerance tuned by play |
| 4 | Grabs + rig | Gate passed 2026-09 — authored anchors, grabs/tweak/shifty wired, pose-mode anchor editing |
| 5 | Rails | **Unfinished** — built, gate not yet played: 50-50, boardslide, tailslide distinct; balance winnable not free |
| 6 | Wallrides + butters | First pass in, started before M5's gate by choice — gate: both chain into and out of other states without a hitch |

The default terrain is the Sochi 2014 Olympic course (`src/park/sochi.ts`) from the FIS
plans, scaled by 9.81/16 = 0.61 so it rides at the real speeds under the sim's gravity:
three jib sections — each a table with a small kicker in, rails and boxes on the deck and a
landing off the end, ridden at ~10 m/s with walls beside — then three pairs of twin kickers — a narrow
takeoff on a wide table (`deckWidth`) — on a stepped profile where the slope drops away
under each landing. Snow friction (`ground.friction`, μ 0.06) is what lets a stepped course
hold its speed; powder can later be its own μ. `?park=slopestyle` loads the first park.

The first test terrain is a small slopestyle line in `src/park/slopestyle.ts` — rails, a wall,
two kickers, a last rail and a corner, with near-flat decks (`grades`) holding speed
between them. The corner (`corners` in the slope config) is a straight takeoff onto a long
narrow deck with landings falling away on both sides and ahead: carve across the takeoff
toward your toes for the frontside landing, toward your heels for the backside one.
At the bottom is a quarter pipe (`quarters`), facing uphill, ridden at full gravity — the
wallride's reduced gravity applies to wall surfaces only. A heightfield can't be vertical,
so leaving a quarter-pipe face drops the horizontal speed that would carry you over the
deck and adds `wall.vertReturn` back into the pipe: airs go straight up and land back on
the face. Popping on the face adds to the climb, like the pop onto a wall. Because that
pop goes into the climb, leaving the top is the takeoff (`wall.lipTakeoff`): the stick at
the lip sets the spin as it would at a pop, within `air.takeoffWindow`. The spin turns in
the wall's plane, so every 180 lands: nose down forward, nose up fakie.
Hand-placed data; milestone 7 moves it to `park.json`.

---

## 13. Open questions — resolve by playing, not by discussing

1. ~~Is `air.authority` at 0.35 too punishing for a pad player?~~ **Resolved by play:**
   yes, and the units were wrong too. See §5 — it is now a rate in 1/s against the same
   scale takeoff uses.
2. Should switch riding invert the edge mapping, or is heading-relative enough?
3. Does `speedFactorKnee` at 6 m/s make slow-speed riding feel dead?
4. ~~Rail balance: noise-driven, or fully deterministic from entry angle?~~ **Decided:**
   deterministic. Learnable beats tense; noise can be layered later if it plays free.
5. Does a scoreless game need a "clean/sketchy" stamp at all, or is the physical read
   enough? Build without it, add only if the game feels mute.
6. Crossed grabs (crail, roast beef) need the hand that §7.3's reach rule would not
   pick. LB/RB are already shifty in the air. Modifier, or just accept that the rig
   does not do crossed grabs?
7. What rotates a tweak? Depth is one scalar but the axis is not obvious — pushing a
   nose grab and pushing a tail grab should not swing the board the same way. Likely
   perpendicular to the line from grab point to the pushing foot, but settle it in
   pose mode with sliders, not on paper.
8. `grab.tweakRecover` at 14 is a guess, and given that recovery is automatic (§7.4) it
   is the *only* thing setting how forgiving the wager in §6 is. Too fast and tweak
   depth is free; too slow and a late grab is a coin flip. Probably the single most
   important number in milestone 4.
9. Does the shoulder/head lead in §7.7 survive at 120 Hz without looking like the head
   is on a spring? If it reads as wobble rather than intent, raise `rig.spineStiffness`
   before cutting the feature.
10. The carve has no **grip limit**. `ground.gripEdge` is a damping rate, not a maximum
    lateral force, so a set edge holds regardless of how much lateral acceleration the
    turn implies; speed is lost by stalling into the fall line rather than by washing
    out. Real edges let go. If hard carves feel like rails right up until they stop,
    the fix is a lateral-force cap that degrades grip once exceeded — not lowering
    `gripEdge` everywhere, which would make gentle turns skid too.
