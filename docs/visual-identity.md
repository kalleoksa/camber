# Visual identity — milestone 9

Extends `CLAUDE.md` milestones and `design.md` §11. **Gated behind milestone 4.** Nothing
here starts until every grab anchor is authored and approved on bare geometry.

---

## 1. Why the blocks stay

The box rider is not a placeholder waiting for art. It is the measuring instrument.

Baggy outerwear is a silhouette modifier. Put a jacket on the current Japan and a
1.08 × 1.84 outline becomes roughly 1.4 × 1.9 and reads as acceptable — which would have
hidden the torso-lean defect that the aspect metric just caught. Every visual addition
before the anchors are locked conceals the exact class of bug being hunted.

So: no clothing, no materials, no terrain art until milestone 4 passes its gate.

---

## 2. Cloth is a mechanic, not polish

This is the correction. The original plan had nothing on visuality, which was right for
art direction and **wrong for cloth**.

In real snowboarding, clothing is how speed and rotation are read: pant flap, jacket lag,
the delay between the body stopping and the fabric catching up. That is the same
secondary-motion channel as the Verlet overshoot on the trailing arm — a feel signal, not
decoration. It belongs in `design.md` §11 alongside camera and audio, under "truth to
snowboarding."

Practical consequence: cloth motion should be driven by the same spring/overshoot system
already used for the trailing arm, not by a separate solver bolted on later.

---

## 3. Hard constraints

1. **Render-side only.** Cloth state never enters `src/sim/**`. A solver in the sim loop
   breaks invariant 4 (determinism) and invariant 6 (seeded randomness) outright.
2. **Zero allocation per frame.** Same rule as the sim loop. Pre-allocate bone arrays and
   scratch vectors at load.
3. **No real cloth simulation.** Vertex-shader wind offset driven by speed, plus two or
   three extra bones per pant leg and one per jacket tail, gets ~90% of the read at zero
   risk. If it ever needs a constraint solver, the scope is wrong.
4. **Replay must reproduce cloth.** Because replay is the reward loop (§11), cloth driven
   by unseeded noise will differ between a run and its replay. Drive it from sim state
   (speed, angular velocity, contact impulse) plus the seeded PRNG — never from wall
   clock or `Math.random`.

---

## 4. Direction

Art direction is the rider's call. These are technical steers only.

- **Flat or toon shading, not PBR.** Cheaper, holds the silhouette instead of dissolving
  it into specular highlights, and survives the browser's fill-rate limits on an iPad.
  Snow rendered realistically is a research problem; snow rendered graphically is a
  palette decision.
- **Rider must stay dark and saturated against snow.** The environment is near-white, so
  the rider carries all the contrast. This is also what keeps the silhouette test valid
  after art lands.
- **The board base graphic is functional.** `tweakRoll` shows the base — a base graphic
  is what makes roll legible. Keep it high-contrast and asymmetric so the direction of
  roll reads, not just its presence.
- **Goggles give the head a direction.** Head look-at is a documented style cue (§7.7),
  but a featureless box can't express gaze. Goggles or a helmet stripe are the cheapest
  way to make the head read as pointing somewhere.
- **Faceless, single rider, no customization.** Out of scope. Personal project, no
  progression, no cosmetics economy.

---

## 5. Re-validation protocol

The aspect and silhouette bands in `grabs.md` §6 and `patch-rig-frames.md` §8 were
measured on bare geometry. They will shift once cloth is on. So:

1. **Keep the bare orthographic silhouette view permanently.** It is the authoring and
   regression view, not a temporary debugging tool. Do not remove it when art lands.
2. **Dressed silhouette is a separate check**, run after, with its own bands.
3. **Re-run all four acceptance tests** (COM invariance, knee symmetry, reach validity,
   aspect) with cloth enabled and disabled. Any divergence means cloth is influencing
   the rig, which it must not.
4. **Re-shoot the anchor snapshots** dressed, stored alongside the bare ones in the
   `provenance` block. If a pose stops reading once clothed, that is a cloth-fit problem
   to solve in the mesh, never by editing an approved driver vector.

---

## 6. Milestone 9 definition

| Step | Content |
|---|---|
| 9a | Skinned humanoid replaces boxes. Bone quaternions written directly — never `AnimationMixer`. Re-run acceptance tests. |
| 9b | Flat/toon shading pass, palette, board base graphic, goggles. |
| 9c | Cloth secondary motion via added bones + vertex wind, driven from sim state and the seeded PRNG. |
| 9d | Terrain and snow look. Graphical, not physical. |

**Gate:** a replay of a clean run reads as snowboarding footage to someone who rides,
with the bare-silhouette regression tests still passing unchanged.

---

## 7. Do not

- Add PBR snow, screen-space reflections, or any deferred lighting path.
- Run a real cloth solver, in the sim loop or out of it.
- Remove or bypass the bare silhouette view.
- Edit an approved driver vector to fix a clothing problem.
- Start any of this before milestone 4's gate passes.
