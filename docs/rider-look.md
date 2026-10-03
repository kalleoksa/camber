# Rider look — plan (milestone 9a–9c)

Status: 9a–9c first pass built (`outfit.ts`, `board.ts`, `toon.ts`, cloth in `secondary.ts`). Gates are yours. Implements `docs/visual-identity.md` §6 steps 9a–9c.
The constraints there (render-side only, no cloth solver, replay reproduces cloth, bare
silhouette view kept) apply unchanged and are not repeated here.

Decision taken: **procedural**. No mesh files, no modelling tool, no new dependency.

---

## 0. As built (9a)

- **Rigid pieces, not skinning.** Each piece is a lathe tube or blob parented to the rig's
  existing segment mesh. Limb tubes have domed ends centred on the joints, so the thigh's
  and the shin's domes are one sphere at the knee: a bend reads as a bent tube, not a gap.
  No bones, no bind pose. Skinning (below) stays the upgrade path if knee/elbow creasing or
  waist twist ever reads badly.
- Silhouette from your references:
  - Olive, wide straight-leg pant with a soft break over the boot.
  - Boxy raglan shell ending just below the hips, black (was teal yoke, sleeves and hood
    over a rust body).
  - Black beanie with the goggles pushed up on it.
  - Oversized mitts.
- Fit numbers and palette are the `OUTFIT` const in `outfit.ts`, edited in code (Vite
  reloads). They aren't in Tweakpane yet.
- `status → dressed` toggles the dressed view; `?look=bare` starts bare. The reach overlay
  tints the bare segments only.

- **9b as built:**
  - `MeshToonMaterial` with a 3-step ramp.
  - Inverted-hull outlines, pushed out in view space so the width holds at any distance
    and limb scale.
  - Seeded, tileable camo on the pants from your reference, with UVs in metres along each
    tube so the patches keep their size.
  - The board and bindings are toon too; the terrain isn't.
- **9c as built:**
  - The jacket skirt (pivot at the waist) and the hood (pivot at the neck) are 2-axis
    springs on the fixed tick in `Secondary`. The skirt is blown back by travel in the
    board frame; the hood trails the spin; both kick on the landing tick.
  - Shell flutter is a vertex offset from sim time and speed only.
  - Params live in `params.cloth`. The determinism check has a cloth vacuity test: a skirt
    spring change moves the spring hashes and leaves the sim alone.

## 1. Body: one skinned mesh, bones placed from the existing solve (upgrade path)

`rig.ts` already computes every joint per frame — hips, knees, feet, chest, shoulders,
elbows, hands, head — and `placeBone` aims a box from one joint to the next. Keep all of
that. Replace what gets aimed:

- One `THREE.Bone` per segment (pelvis, torso, 2 thighs, 2 shins, 4 arm segments, head),
  **flat, not a hierarchy**, all children of the rig root. Each bone gets the position and
  quaternion `placeBone` computes today. No bone-chain maths, no `AnimationMixer`.
- A `THREE.SkinnedMesh` whose geometry is generated in code at load: tubes along each
  segment, built in a rest pose, with bone inverses taken from that rest pose.
- Joints blend: vertices within a blend band around a knee, elbow or waist are weighted
  across the two bones, so the joint bends instead of gapping. Band width is a fit number.
- Rigid pieces stay plain meshes parented to their bone: boots, mitts, helmet or beanie,
  goggles.

Why flat bones: the rig solves joint positions, not joint angles. Converting to a parent
chain means deriving local rotations only to have Three recompose the same world
transforms. Placing each bone in world space skips that and reuses code that already
passes the pose gate.

## 2. Outfit as radius profiles

Every clothing layer is a tube along one or more segments, defined by a radius profile
(radius at a few stations along the segment, lathe-style) and a cross-section scale.

| Layer | Segments | What sells it |
|---|---|---|
| Pants | thigh + shin per leg | Wide through the knee, **stacked at the boot** (extra rings bunched above the ankle, radius oscillating), hem flared over the boot top |
| Jacket | torso + pelvis, sleeves on upper/lower arm | Hem **past the hips**, loose at the waist, sleeves wide and stacked at the mitt |
| Hood | back of torso top | A lump behind the neck, own bone for §4 |
| Headwear | head, rigid | Helmet or beanie; goggles with strap as a band |
| Mitts, boots | rigid | Oversized mitts |

Silhouette is the priority over detail. Baggy pants stacking on the boot is the single
strongest "snowboarder" cue; spend effort there first.

Fit numbers (radii, jacket length, stack count, blend band) live in one render-side
`OUTFIT` object and are bound in Tweakpane under a `look` folder. They don't touch the sim
or the springs, so they are not part of `params` or takes.

Target: under 10k vertices total.

## 3. Shading (9b)

- `MeshToonMaterial` with a 3-step gradient map generated as a `DataTexture` in code.
- Outline by inverted hull: a second draw of the skinned mesh, back faces only, pushed out
  along normals in the vertex shader, flat dark colour. Cheap, and it holds the silhouette
  against white snow.
- Palette: one const of colour tokens. Dark saturated outfit, bright goggle lens, one accent
  colour. Art direction is yours.
- Board base graphic: a `CanvasTexture` drawn in code, high-contrast and asymmetric so the
  direction of `tweakRoll` reads.

## 4. Cloth motion (9c)

Four cloth bones (six with sleeves), each a 2-axis angular spring offset from its parent segment:

| Bone | Parent | Driven by |
|---|---|---|
| Pant hem ×2 | shin | relative wind (speed), knee flex rate |
| Jacket tail | pelvis | relative wind, spin rate (lags behind rotation), landing impact |
| Sleeve hem ×2 (optional) | lower arm | relative wind |
| Hood | torso | spin rate, landing impact |

- State lives in `Secondary` (`src/render/secondary.ts`), stepped on the fixed tick next
  to the hip, twist and head springs. About 16–24 numbers; zero allocation.
- Inputs are sim state only: velocity in the rider frame, `spinRate`, `impact`,
  compression. No clock, no `Math.random`.
- Spring constants go in `params.cloth` with unit comments and Tweakpane bindings — like
  `rig.hipStiffness`, they change the spring hash, so takes must carry them.
- **Flutter:** vertex-shader offset along the normal, amplitude from speed, phase from
  `(tick + alpha) · rate` fed as a uniform. A pure function of sim time, with no
  accumulated state, so replay shows the same flutter.

## 5. Bare view stays

- `view=silhouette` (used by `scripts/pose-gate.ts`) keeps drawing the current boxes.
  The box meshes stay in `rig.ts`; the dressed mesh is a second view, default in play.
- Both views read the same bone placements, so they cannot drift apart.

## 6. Files

| File | Change |
|---|---|
| `src/render/body.ts` | new: tube/profile geometry builder with skin weights |
| `src/render/outfit.ts` | new: `OUTFIT` layers, fit numbers, palette |
| `src/render/toon.ts` | new: toon material, gradient map, outline, flutter shader chunk |
| `src/render/rig.ts` | bones placed alongside the boxes; view switch |
| `src/render/secondary.ts` | cloth springs |
| `src/sim/params.ts` | `cloth` group (springs only) |

This touches more than two files, so it needs your OK before starting (CLAUDE.md working
agreement). This doc is that request.

## 7. Steps and gates

| Step | Content | Gate |
|---|---|---|
| 9a | Skinned body + outfit layers, static (no cloth motion), default shading | `pose-gate.ts` bare numbers unchanged; every anchor still reads dressed (your call, from dressed silhouette shots) |
| 9b | Toon shading, outline, palette, goggles, base graphic | Rider reads against snow at chase-cam distance; roll direction readable from the base |
| 9c | Cloth bones + flutter | Replay reproduces cloth (spring hash); speed and spin readable from cloth with the readout hidden |

## 8. Verification

- `npm run determinism`: add a cloth vacuity check — changing a `cloth` param moves the
  spring hashes and leaves the sim hashes unchanged, mirroring the existing
  `hipStiffness` check.
- `scripts/pose-gate.ts`: bare-view results bit-identical before and after.
- Render frame: no allocation (same review rule as the sim).
- 60 fps on the MacBook in Chrome with the dressed rider and spray on.

## 9. Risks

- **Clipping in deep grabs.** Method, stalefish and a boned japan fold the body hard.
  Accept small clipping; widen the blend band and the radius at knees and hips. Never
  fix it by editing an approved anchor (visual-identity §7).
- **Candy-wrapper twist** at the waist under large `spineTwist`: linear skinning
  collapses the tube. Mitigation: add a mid-torso bone at half the twist.
- **Bagginess hides rig defects.** This is why the bare view and pose gate stay.

## 10. Ordering and estimate

CLAUDE.md sequences milestones; M5 rails is open. Recommend finishing the M5 feel test
first.

- 9a: 1–2 days
- 9b: ~half a day
- 9c: 1–2 days, plus your tuning time

## 11. Your calls

- Palette and outfit (helmet vs beanie, jacket length, how baggy).
- Whether sleeve hem bones are worth it (optional in §4).
