# Grab reference — physiology

Companion to `design.md` §2. Written to be read by Claude Code as implementation
reference. All joint values are ballpark estimates derived from video reference, not
measurements — they are slider starting points, not truth.

---

## 1. The generative model — read this before any individual grab

The `(edge, t, hand)` coordinate in `design.md` §2 is **incomplete**. Real grabs need
four grab parameters plus a tweak layer:

```
grab  = hand × edge × t × armRouting
tweak = boneMap × spineBend × spineTwist × boardOffset
```

- **`hand`** — `front` | `back`. Front hand is the lead hand (regular = left).
- **`edge`** — `toe` | `heel`. Which spline.
- **`t`** — 0 (tail) to 1 (nose) along that spline.
- **`armRouting`** — `outside` | `betweenLegs` | `crossed`. **This is the missing
  dimension.** The same `(hand, edge, t)` reached by a different arm path is a different
  named trick with a completely different silhouette. Roast beef and stalefish grab
  nearly the same spot; one goes between the legs, one behind the back leg.
- **`boneMap`** — which leg extends. `front` | `back` | `both` | `neither`. "Boned" =
  extended. This is where most of the perceived style lives.

Grab identity is the first four. Trick *name* is the whole eight. Do not enumerate names
in the input layer — the player reaches, and the replay layer can label it afterward if
we ever want that.

---

## 2. Constraints that apply to every grab

**The boot removes the ankle.** A snowboard boot allows maybe 10–15° dorsiflexion and
almost no inversion or eversion. So all reach comes from knee flexion, hip flexion and
rotation, and spine. Never author ankle motion. This is the single biggest difference
from a skateboard rig, where the ankle is free.

**Toe-edge grabs are easy, heel-edge grabs are hard.** The toe edge sits on the side the
rider's toes and chest face — tucking the knees brings it straight up into the hand.
The heel edge is behind the legs, so reaching it requires either going around a leg,
between the legs, or twisting the torso. This asymmetry is real and should be reflected
in how much spine rotation each grab costs.

**The arm is a tension member, never an actuator.** Once anchored, the hand does not lift
the board. Legs push the board away against the anchored hand. Board orientation is the
*effect*; knee and hip action is the *cause*. Implementing it the other way round
produces poses that are geometrically correct and read as dead.

**COM stays on the parabola.** Every pose must conserve the centre of mass on its
ballistic path. If tucking the legs moves the board back, the hips must move forward by
the mass-weighted equivalent. This one constraint generates most of what people read as
"authentic" — including the arch in a method, which is largely counter-rotation
(15–25° opposite the board's rotation) rather than decoration.

**Crossed and between-leg routings cost torso rotation**, which means they interact with
spin. A crail on a frontside spin fights the rotation; on the other direction it assists.
Expect to cap `armRouting: crossed` grabs at lower spin rates, or accept that they feel
harder — which is correct.

---

## 3. The grabs

### Indy — back hand, toe edge, t ≈ 0.35, outside

The default grab, and the easiest, because the toe edge comes to the hand.

Chain: both knees flex, back knee more → board rises toe-side → back arm reaches down
and slightly forward → torso flexes ~20–30° → front arm out as counterweight.

Back knee 100–120°, front knee 70–90° if boned (extended for style), spine flexion
20–30°, minimal twist. Boned indy extends the *front* leg, pushing the nose down and
away — that's the version worth having as an anchor pose.

Reads wrong if: torso stays upright (looks like the rider is bending at the waist only),
or both knees tuck equally (compact and characterless).

### Mute — front hand, toe edge, t ≈ 0.55, outside

Same edge as indy, opposite hand, slightly further toward the nose. The front arm reaches
down and back, which is a shorter and more symmetrical reach than indy.

Both knees 95–110°, spine flexion 15–25°, slight twist toward the tail. Commonly boned
on the tail. The silhouette is *compact and square* — that's its identity. If it looks
sprawling, it's drifting toward Japan.

### Melon — front hand, heel edge, t ≈ 0.5, outside

First of the hard ones. The front arm must pass down and **behind the front leg** to
reach the heel edge. Requires hip external rotation and 20–30° of spine rotation toward
the tail.

Knees 100–115°, hips flexed, chest turned slightly toward the tail, trailing arm out.
Board sits roughly under the rider rather than behind.

Reads wrong if: the arm passes in front of the leg (anatomically impossible at that
`t`, and CC's IK solver will happily do it — constrain the elbow pole vector).

### Method — front hand, heel edge, t ≈ 0.5, outside

**Identical grab coordinate to melon.** The difference is entirely tweak: knees flex hard
to bring the board up and *behind*, hips extend 10–20° forward, lumbar extends 25–30°,
thoracic 15–25°, trailing arm to 150–170° shoulder flexion, head extends and gaze goes
back over the lead shoulder. Lead elbow stays 10–20° — near-straight is what "boned"
means.

Board vs clean frame: 70–100°, nose up and back.

Full physiological breakdown was given separately; the key architectural point is that
method and melon share a grab and differ only in the driver vector. This is the proof
that grab and tweak must be separate systems.

### Stalefish — back hand, heel edge, t ≈ 0.35, outside

The back arm reaches down and **behind the back leg**. Shoulder extension plus internal
rotation, which is a genuinely restricted range — the reason stalefish looks
uncomfortable is that it is.

Back knee 105–120°, front leg often boned to 60–80°, spine rotation 15–25° toward the
nose, spine flexion 15–20°. Board typically boned tail-down.

Reads wrong if: the arm goes between the legs — that's a roast beef.

### Nosegrab — front hand, t ≈ 0.9, either edge or the tip

Chain: front knee flexes hard while back leg extends → nose comes up, tail drops → deep
hip flexion 100°+ → spine flexion 30–40° → front hand meets the nose.

Front knee 110–125°, back knee 25–45° (near straight), spine flexed *forward* — this is
the one grab family where the spine flexes rather than extends. Board pitches nose-up
40–70°.

The tuck is deep and rounded. If the spine stays neutral, the rider looks like they're
pointing at the nose rather than grabbing it.

### Tailgrab — back hand, t ≈ 0.05

Mirror of nosegrab, but the spine *extends* rather than flexes, so it looks completely
different despite being geometrically symmetrical. Back knee flexes 105–120°, front leg
extends to 30–50°, lumbar extension 20–25°, chest opens. Board pitches tail-up 40–70°.

Because the spine arches, tailgrab and method share a family resemblance and blend well.
Nosegrab does not blend with either — worth knowing when building the interpolation graph.

### Japan — front hand, toe edge, t ≈ 0.65, outside

Toe-side cousin of the method, and the most demanding of the common grabs. Front hand
takes the toe edge *ahead of the front binding*, then both knees flex hard and the board
is pulled up and behind while the back arches.

Front knee 110–125°, back knee 100–115°, lumbar extension 20–30°, spine rotation 25–35°,
lead elbow 30–50° (more bent than a method — the reach is shorter). Board vs clean
frame 60–90°, nose up and behind.

Reads wrong if: the arch is missing → it's just a tweaked mute.

### Crail — back hand, toe edge, t ≈ 0.7, crossed

The back arm crosses the body to reach past the front foot. Costs 30–45° of torso
rotation, which is why it interacts with spin direction more than any other grab here.

Back knee 95–110°, front leg boned to 60–80°, shoulder flexion plus adduction across the
midline, spine twist 30–45°. The silhouette is a diagonal — arm one way, board the other.

### Roast beef — back hand, heel edge, t ≈ 0.35, **betweenLegs**

Same coordinate region as stalefish; the arm goes *between the legs* instead of behind
the back one. Requires knees apart and deep hip flexion, which forces a squat-like pose
rather than a tuck.

Both knees 110–125°, hip abduction 20–30°, spine flexion 25–35°. Compact and low.

This grab exists in the doc mainly to justify the `armRouting` parameter — without it,
roast beef and stalefish are the same trick.

### Tindy — back hand, toe edge, t ≈ 0.15, outside

Back hand on the toe edge *behind* the back foot. Universally considered sloppy — it's
what an indy looks like when the reach falls short. Worth modelling deliberately so the
system can produce it as a *failure* of an intended indy rather than treating it as a
target. Good candidate for the sketchy read in §10.

### Exotic routings — implement only if the model generalizes for free

Canadian bacon (front hand, heel edge, betweenLegs, behind the back leg), seatbelt
(front hand crossed to the tail), chicken salad (back hand betweenLegs with the arm
rotated). All fall out of the four grab parameters plus routing. If the parameterization
is right, these need zero new code. If they need special cases, the parameterization is
wrong — treat them as a test of the model rather than as features.

---

## 4. Data block

Starting values. Every number is a Tweakpane binding; anchor poses are presets of the
full driver vector, not of skeleton transforms.

```ts
export type Hand = 'front' | 'back';
export type Edge = 'toe' | 'heel';
export type ArmRouting = 'outside' | 'betweenLegs' | 'crossed';
export type BoneMap = 'front' | 'back' | 'both' | 'neither';

export interface GrabAnchor {
  hand: Hand;
  edge: Edge;
  t: number;              // 0 tail .. 1 nose
  routing: ArmRouting;
  bone: BoneMap;
  kneeFront: number;      // rad flexion
  kneeBack: number;
  hipFlex: number;
  spineBend: number;      // + extension (arch), - flexion (tuck)
  spineTwist: number;     // + toward nose
  trailingArm: number;    // shoulder flexion
  boardOffset: number;    // rad, board vs clean frame about grab point
  reachCost: number;      // 0..1, difficulty — drives max tweak depth and spin cap
}

export const grabAnchors: Record<string, GrabAnchor> = {
  indy:      { hand: 'back',  edge: 'toe',  t: 0.35, routing: 'outside',     bone: 'front',   kneeFront: 1.40, kneeBack: 1.92, hipFlex: 1.00, spineBend: -0.44, spineTwist:  0.00, trailingArm: 1.20, boardOffset: 0.50, reachCost: 0.15 },
  mute:      { hand: 'front', edge: 'toe',  t: 0.55, routing: 'outside',     bone: 'back',    kneeFront: 1.75, kneeBack: 1.75, hipFlex: 0.90, spineBend: -0.35, spineTwist: -0.20, trailingArm: 1.10, boardOffset: 0.45, reachCost: 0.20 },
  melon:     { hand: 'front', edge: 'heel', t: 0.50, routing: 'outside',     bone: 'neither', kneeFront: 1.85, kneeBack: 1.85, hipFlex: 1.05, spineBend: -0.20, spineTwist: -0.44, trailingArm: 1.30, boardOffset: 0.55, reachCost: 0.45 },
  method:    { hand: 'front', edge: 'heel', t: 0.50, routing: 'outside',     bone: 'neither', kneeFront: 1.83, kneeBack: 1.83, hipFlex: 0.30, spineBend:  0.92, spineTwist: -0.30, trailingArm: 2.75, boardOffset: 1.48, reachCost: 0.70 },
  stalefish: { hand: 'back',  edge: 'heel', t: 0.35, routing: 'outside',     bone: 'front',   kneeFront: 1.22, kneeBack: 1.96, hipFlex: 0.95, spineBend: -0.30, spineTwist:  0.35, trailingArm: 1.15, boardOffset: 0.60, reachCost: 0.55 },
  nosegrab:  { hand: 'front', edge: 'toe',  t: 0.90, routing: 'outside',     bone: 'back',    kneeFront: 2.05, kneeBack: 0.60, hipFlex: 1.75, spineBend: -0.61, spineTwist:  0.00, trailingArm: 1.40, boardOffset: 0.95, reachCost: 0.50 },
  tailgrab:  { hand: 'back',  edge: 'toe',  t: 0.05, routing: 'outside',     bone: 'front',   kneeFront: 0.70, kneeBack: 1.96, hipFlex: 0.40, spineBend:  0.40, spineTwist:  0.00, trailingArm: 1.50, boardOffset: 0.95, reachCost: 0.45 },
  japan:     { hand: 'front', edge: 'toe',  t: 0.65, routing: 'outside',     bone: 'neither', kneeFront: 2.05, kneeBack: 1.88, hipFlex: 0.55, spineBend:  0.44, spineTwist: -0.52, trailingArm: 2.40, boardOffset: 1.31, reachCost: 0.80 },
  crail:     { hand: 'back',  edge: 'toe',  t: 0.70, routing: 'crossed',     bone: 'front',   kneeFront: 1.22, kneeBack: 1.79, hipFlex: 0.95, spineBend: -0.25, spineTwist: -0.65, trailingArm: 1.10, boardOffset: 0.70, reachCost: 0.75 },
  roastbeef: { hand: 'back',  edge: 'heel', t: 0.35, routing: 'betweenLegs', bone: 'neither', kneeFront: 2.05, kneeBack: 2.05, hipFlex: 1.30, spineBend: -0.52, spineTwist:  0.15, trailingArm: 1.00, boardOffset: 0.40, reachCost: 0.65 },
  tindy:     { hand: 'back',  edge: 'toe',  t: 0.15, routing: 'outside',     bone: 'neither', kneeFront: 1.20, kneeBack: 1.60, hipFlex: 0.85, spineBend: -0.35, spineTwist:  0.10, trailingArm: 0.90, boardOffset: 0.30, reachCost: 0.10 },
};
```

`reachCost` is doing real work: it should cap achievable tweak depth, slow the rate at
which the pose can be reached, and reduce in-air spin authority while held. That's how
a Japan comes to feel harder than an indy without any of it being special-cased.

---

## 5. Timing envelope

As a fraction of airtime, applies to all grabs:

- 0.10–0.20 reach begins, board starts to move
- 0.40–0.55 peak tweak
- 0.65 retraction begins
- 0.85 recentred, legs loaded to absorb

Holding past ~0.85 means landing with the board well off axis, which the §6 landing test
punishes on its own. Multiply the window by `(1 - reachCost * 0.3)` so harder grabs are
genuinely harder to recover from.

---

## 6. Visual test suite

For the milestone 4 slider gate. Each must be identifiable at a glance, posed with
Tweakpane alone and gameplay disconnected:

| Confusion | Discriminator |
|---|---|
| Method vs melon | Spine extension and board behind the rider |
| Japan vs tweaked mute | Presence of the arch |
| Stalefish vs roast beef | Arm behind the back leg vs between the legs |
| Indy vs tindy | Grab position relative to the back foot |
| Nosegrab vs tailgrab | Spine flexed vs extended |
| Crail vs mute | Which arm crosses the midline |

If any pair is ambiguous, the driver vector is under-specified — fix the rig, not the
gameplay code.
