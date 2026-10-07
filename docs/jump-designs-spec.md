# Camber — Jump Designs Spec

Oct 5, 2026 · Source: [https://claude.ai/artifact/WyvhtzdXiYuPqU2N6cvRYy](https://claude.ai/artifact/WyvhtzdXiYuPqU2N6cvRYy)

## Overview

Detailed specs for every park jump feature, in three families: straight jumps (landing in line with the takeoff), angled jumps (transfers), and walls (ridden up and back down). The Hip Jump Spec holds the full detail for hips; this doc summarises them alongside the rest.

All designs are compositions of the shared blocks (Feature Catalogue Spec). Straight jumps use Run-in, Takeoff, Table and Landing, and differ in four things only:

1. **Table:** length, or none.
2. **Height offset:** landing start higher (step-up) or lower (step-down) than the lip.
3. **Void:** whether the space between lip and landing has a collider (table) or not (gap).
4. **Size and steepness:** presets.

Angled jumps add a heading change between takeoff and landing (and sometimes a Ridge). Walls use the Wall block and a wall-riding physics mode. Each design is mostly a set of parameter values plus a few design-specific rules.

## Straight jumps: profiles

_Diagram not exported (straight jump designs, side profiles); see the [source doc](https://claude.ai/artifact/WyvhtzdXiYuPqU2N6cvRYy)._

## Shared rules

Apply to every design below unless its section says otherwise. Values come from the Hip Jump Spec research section.

- **Takeoff:** constant-radius transition, last 1–2 m straight at lip angle θ (no late curvature, so riders aren't rotated backward). Lip edge perpendicular to the takeoff heading. Lip dyed.
- **Landing:** constant-EFH profile solved from θ, target EFH and the design speed range. Never set as a fixed angle. Long enough for the arc at max design speed plus 20%.
- **Knuckle:** rounded (radius 3–5 m), dyed. Knuckle landings grade Sketchy, not Bail.
- **Bottom transition and outrun:** transition radius ≥ the takeoff radius; outrun long enough to slow or set up the next feature (Terrain spec line rules).
- **Design speed:** each jump has a min–max speed range. The run-in is sized so a rider who doesn't brake arrives at the max.
- **Grading:** EFH at contact: Stomped ≤ 0.5 m, Clean ≤ 1.0 m, Sketchy ≤ 1.5 m, Bail above.
- **Width:** constant along the feature unless stated; side walls 45° so riders who drift off the side can ride out.

## Straight jumps: designs

### Tabletop

The default park jump. A flat table between lip and knuckle catches short airs, so it's forgiving.

- **Table:** length 3–25 m; height = lip height, so the table is level with the lip edge.
- **Short airs:** land on the table (flat, Sketchy). Never a void, never a bail from undershooting at normal speeds.
- **Gameplay role:** progression and the main body of lines. Most jumps in a park.

### Gap

Same as a tabletop but the table is missing: undershooting means falling into the gap.

- **Void:** no collider between lip and knuckle; terrain is lowered 1.5–3 m below the lip, with the gap's floor rounded so a rider who falls in can ride out (not a pit).
- **Undershoot:** landing in the gap = Bail.
- **Gap length:** must be cleared at min design speed with margin; the generator rejects gaps that can't be.
- **Visual:** dye both lip and knuckle; the gap must read clearly from the run-in.
- **Gameplay role:** commitment. Use sparingly, for hero features.

### Step-down

Landing starts lower than the lip, so the rider gets more airtime at the same speed.

- **Drop:** knuckle 1–6 m below the lip.
- **Landing:** solved for the extra height. Longer and steeper than an equivalent tabletop.
- **Table:** optional; with a table, the table sits at lip height and the drop happens at the knuckle.
- **Gameplay role:** big airtime without needing big speed. Good at line ends and on terrain that falls away naturally.

### Step-up

Landing deck higher than the lip: the rider flies up onto it.

- **Rise:** landing deck 1–3 m above the lip.
- **Landing:** the top of the upper deck, close to flat, then rolling down its far side. The rider arrives near the top of the arc with little downward speed, so impact stays low even on a flat deck.
- **Undershoot:** hitting the face of the step = Bail. Clear-the-face distance checked at min design speed.
- **Gameplay role:** short, punchy, technical. Good for stalls and small spins; slows the rider for the next feature.

### Booter

Oversized backcountry-style kicker with a steep lip and no table; the natural slope below is the landing.

- **Lip:** steep end of the θ range (28–30°+), tall lip.
- **Landing:** the natural slope, steep (30–38°). The generator places the booter where the slope already fits the arc at design speed, rather than building a landing.
- **Surface:** usually powder.
- **Gameplay role:** backcountry and natural zones; big rotations.

### Big-air kicker

A tabletop at XL size and beyond, built for maximum rotation.

- **Table:** long (15–25 m); landing long and steep.
- **Speed:** needs a dedicated long run-in; usually one per park, as the hero feature.
- **Gameplay role:** big spins and flips; competition-style showcase.

### Mini / roller kicker

Small, low jump for warm-up and linking lines.

- **Lip:** θ 10–18°, lip height 0.3–0.7 m.
- **Table:** none; a short landing directly after the lip.
- **Gameplay role:** fillers between bigger features, ollie/pop practice, butter and small-spin spots.

## Straight jumps: parameters

Starting values to tune in-game. Sizes use the S–XL presets (design speed, transition radius, width) from the Hip Jump Spec; this table only lists what differs per design.

| Design | Sizes | Lip θ | Lip height | Table | Height offset | Void | Target EFH |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Tabletop | S–XL | 20–28° | 1.0–3.0 m | 3–25 m | 0 | No | 0.5–1.0 m |
| Gap | M–XL | 22–28° | 1.5–3.0 m | — (gap 4–20 m) | 0 | Yes | 0.7–1.0 m |
| Step-down | S–XL | 18–26° | 1.0–2.5 m | 0–10 m | −1 to −6 m | Optional | 0.7–1.0 m |
| Step-up | S–M | 24–30° | 1.0–1.5 m | — | +1 to +3 m | Yes (face) | 0.5 m |
| Booter | L–XL | 28–32° | 2.5–4.0 m | — | natural slope | Yes | 1.0 m |
| Big-air | XL+ | 26–32° | 3.0–4.0 m | 15–25 m | 0 | No | 1.0 m |
| Mini / roller | S | 10–18° | 0.3–0.7 m | — | 0 | No | 0.5 m |

Target EFH is lower on small and technical features (stomps feel crisp) and higher on big ones (bigger landings would get too long otherwise).

## Angled jumps: plan views

_Diagram not exported (angled jumps, plan views); see the [source doc](https://claude.ai/artifact/WyvhtzdXiYuPqU2N6cvRYy)._

All angled jumps need two physics rules from the Hip Jump Spec: in-air board roll/pitch alignment toward the predicted landing, and landing slip measured against velocity projected onto the landing.

## Angled jumps: designs

### Hip

Straight takeoff down the fall line; landing falls away to one side. Full spec in the Hip Jump Spec.

- **Hip angle:** 90° default, 45–60° for mellow ones.
- **Table:** optional, in line with the takeoff; the knuckle runs along its side, so the hip landing is long. A second straight landing at the table's end.
- **Landing:** constant-EFH profile per aim heading, lofted; side pitch 15–30°. Wraps around the takeoff when there's no table.
- **Gameplay role:** the main transfer feature; frontside/backside spins off the side.

### Double hip

A hip mirrored to both sides of one takeoff.

- **Shared table** with knuckle lines on both sides and a second landing at the end.
- **Side choice** comes from the rider's aim; the lip is wide enough to set up either way.
- **Gameplay role:** hero feature in the middle of a park; two lines from one takeoff.

### Step-down hip

A hip whose side landing is lower than the lip.

- **Drop:** 1–4 m below the lip; landing solved for the extra height.
- **Gameplay role:** more airtime and hang time for spins than a level hip at the same speed. Fits where the terrain already falls away to the side.

### Corner

The takeoff faces across the slope; the landing lines up with the flight, and the outrun turns back downhill.

- **Takeoff yaw:** 45–90° off the fall line.
- **Landing:** cone section centred on the lip, covering the flight heading ±20°; pitch along each heading from EFH; cross-tilt under 10°.
- **Outrun:** blends back to the fall line over 10–15 m.
- **Gameplay role:** redirects a line across the hill; the turn happens after landing, not in the air.

### Spine

A ridge with a face on each side. The rider rides up one face and airs across the ridge onto the other.

- **No lip:** the up-face is the takeoff. Its top angle sets the takeoff angle (20–30°).
- **Ridge:** crest radius ≥ 3 m, dyed.
- **Down-face:** a constant-EFH landing.
- **Angled spine transfers:** approaching at an angle gives a transfer; tag both faces for the connection graph.
- **Gameplay role:** flowing transfers; works both directions if both faces are shaped as takeoffs and landings.

### Wedge / pyramid

A raised block whose 2–4 faces work as takeoffs or landings depending on approach.

- **Faces:** each face shaped to work as both: transition at the base, straight top section at 20–25°.
- **Top:** rounded flat (a ridge when 2-sided, a small deck when 4-sided).
- **Uses:** hit head-on = kicker; from the side = hip; across = spine.
- **Gameplay role:** discovery. One feature, many lines; strong for procedural parks.

### Euro gap

A tabletop with a rail or box on the table; the rider airs over it.

- **Rail:** on the table, height ≤ table + 1 m, set back at least 2 m from the knuckle; length 4–8 m.
- **Clearance:** checked at min design speed. A rider who doesn't clear can land on the rail (it's a real jib) or the table.
- **Gameplay role:** visual commitment without a void; doubles as a jib for slower riders.

## Angled jumps: parameters

Starting values to tune in-game.

| Design | Sizes | Lip θ | Heading change | Height offset | Table | Target EFH |
| --- | --- | --- | --- | --- | --- | --- |
| Hip | S–XL | 20–30° | 90° (45–60° mellow) | 0 | 0–25 m | 0.5–1.0 m |
| Double hip | M–XL | 20–30° | ±90° | 0 | 5–25 m | 0.7–1.0 m |
| Step-down hip | M–XL | 20–28° | 60–90° | −1 to −4 m | 0–15 m | 0.7–1.0 m |
| Corner | S–L | 20–28° | takeoff 45–90° off fall line | 0 | — | 0.5–0.8 m |
| Spine | S–L | 20–30° (face top) | 0–45° approach | 0 | — | 0.5–0.8 m |
| Wedge / pyramid | S–M | 20–25° (faces) | any | 0 | small top deck | 0.5 m |
| Euro gap | M–L | 22–28° | 0 | 0 | 8–18 m (with rail) | 0.7–1.0 m |

## Walls: profiles

_Diagram not exported (walls, cross-sections); see the [source doc](https://claude.ai/artifact/WyvhtzdXiYuPqU2N6cvRYy)._

**Wall-riding physics (needed by every wall):** a wall mode where gravity is resolved against the wall's surface normal so the rider can carve up and across near-vertical surfaces; board aligned to the surface; air off the coping keeps horizontal velocity parallel to the wall, so the rider lands back on the transition. Without this, walls work only as steep kickers.

## Walls: designs

### Quarterpipe

One transition curving up to a short vertical section; the rider airs straight up and lands back on the same wall.

- **Transition radius:** roughly equal to wall height; a tighter radius feels more aggressive.
- **Vert:** 0.3–0.5 m vertical at the top so air goes straight up rather than out onto the deck.
- **Deck:** flat platform behind the coping, 2–3 m, so overshooting isn't a fall.
- **Placement:** facing across or up the slope at the end of a line, where speed would otherwise be wasted.
- **Gameplay role:** big airs and spins that return the rider to the run; line enders.

### Halfpipe / superpipe

Two facing quarterpipes with a flat bottom, running down the fall line.

- **Walls:** about 6.7 m (22 ft) for a competition-style superpipe, 3–4 m for a park pipe. Vert at the top as for a quarterpipe.
- **Flat bottom:** 10–15 m wide between the transitions.
- **Pitch down the slope:** about 16–18°, so the rider keeps speed wall to wall.
- **Length:** 100–180 m.
- **Gameplay role:** a separate discipline: rhythm, amplitude and wall-to-wall combos. Probably its own zone.

### Mini pipe / channel

A small halfpipe or a trench, low enough to ride wall to wall at park speed.

- **Walls:** 1–2 m, no vert.
- **Flat bottom:** 3–6 m; a channel can be narrower and used as a gap to air across.
- **Gameplay role:** learning walls and linking parts of a park.

### Hip quarter

A quarterpipe whose coping changes direction in plan, so air off one section lands on the next.

- **Angle between sections:** 30–60°.
- **Transition and vert:** as quarterpipe.
- **Gameplay role:** transfers on walls; pairs with the connection graph for discovery.

### Wall ride / berm

A banked wall ridden along rather than aired out of.

- **Bank angle:** berm 30–50°, wall ride 60–80° (needs speed to stay on).
- **Length:** 8–30 m, following a turn or a run edge.
- **No vert, no coping air by default:** the rider rides along it and exits at the end.
- **Gameplay role:** carving flow, redirecting lines, speed retention in turns.

### Tombstone / tap wall

A short vertical wall for taps, stalls and wall-plants.

- **Height:** 1–2 m, small run-up transition in front.
- **Top:** flat, 0.3–0.6 m deep; dyed edge.
- **Contact:** short touches score as taps (like bonks); a held stall scores separately.
- **Gameplay role:** jib/style feature; works as a bonk with the existing bonk rule.

## Walls: parameters

Starting values to tune in-game.

| Design | Wall height | Transition radius | Vert | Other | Physics needs |
| --- | --- | --- | --- | --- | --- |
| Quarterpipe | 2–5 m | ≈ wall height | 0.3–0.5 m | Deck 2–3 m | Wall mode, air back in |
| Halfpipe / superpipe | 3–4 m (park), ≈6.7 m (superpipe) | ≈ wall height | 0.3–0.5 m | Flat bottom 10–15 m, pitch ≈16–18° | Wall mode, air back in |
| Mini pipe / channel | 1–2 m | 2–3 m | none | Flat bottom 3–6 m | Wall mode |
| Hip quarter | 2–4 m | ≈ wall height | 0.3 m | Section angle 30–60° | Wall mode, air to next section |
| Wall ride / berm | 1.5–4 m | — | none | Bank 30–80°, length 8–30 m | Wall mode, speed to stay on |
| Tombstone | 1–2 m | 1–2 m run-up | full face | Top 0.3–0.6 m | Tap/stall detection |

## Build order and Claude Code prompt

1. **Straight:** tabletop on the shared blocks with the EFH solver, then step-down, step-up, gap, mini kicker, big-air. Booter last (needs natural zone and powder).
2. **Angled, part 1:** hip and double hip (Hip Jump Spec), including in-air board alignment and projected-velocity slip.
3. **Angled, part 2:** step-down hip, wedge/pyramid, euro gap, spine, corner.
4. **Wall mode physics:** riding near-vertical surfaces and air back onto the transition. Test on the existing quarterpipe first.
5. **Walls:** quarterpipe on the Wall block, mini pipe, wall ride/berm, tombstone, hip quarter.
6. **Halfpipe / superpipe** as its own zone.

**Prompt (per step):**

```
Read docs/jump-designs-spec.md, plus docs/feature-catalogue-spec.md and docs/hip-jump-spec.md for context.

Implement step <STEP> of the build order (straight, angled or walls).

Rules:
- Each design is a composition of shared blocks with parameters from its family's parameter table. No design-specific mesh code unless the spec says so (gap floor, booter placement, wall vert).
- Landings are always solved with the constant-EFH method, including height offsets and angled headings.
- Angled jumps: in-air board roll/pitch alignment and slip against projected velocity.
- Walls: wall-riding mode; air off the coping returns to the transition.
- Reject parameter sets that can't be cleared at min design speed and log why.
- Dye lips, knuckles, ridges and coping. Colliders from parameters, not render meshes. Tunables in config + debug panel.
- Debug overlay: arcs at min/mid/max speed and EFH colouring.

Start in plan mode: list files to change. After implementing, tell me what to test with a controller.
```
