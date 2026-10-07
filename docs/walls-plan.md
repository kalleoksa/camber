# Walls — plan (redo, 2026-10-07)

A park wallride is a **built panel**: plywood, metal or concrete, standing on the snow, often
with a snow ramp at its foot. What the code calls a wall today (`WallConfig`, surface `wall`) is
a steep snow bank in the heightfield, which no park builds as a wallride. This plan replaces
it as *the* wallride. The snow bank stays for what it is (snow walls, halfpipe sides).

Built walls work like rails, not terrain: a solid object outside the heightfield, with its own
capture and its own state. A heightfield can't hold a vertical face anyway — it's why quarter
pipes needed `vertExit`.

---

## Status (2026-10-07)

**Built: steps 1–3, plus blocks.** `src/sim/walls.ts` (panels, blocks, ramps),
`src/sim/states/walled.ts` (capture, the face, exits, pop), `panel.*` params, drawn in
`render/scene.ts`, `panel` and `block` kinds in the park JSON, `takes/two-stick-panel.json` in
the determinism gate. Talma: a 2.5 m plywood panel with a ramp at z −248, and a hut (a block)
left of the line at z −318.

**Any built obstacle is wallrideable.** A face is the one rideable thing; a `BlockConfig` (a
building, a box) is a solid whose four sides are faces. A free-standing wall is a panel. A
block's roof is a flat raised in the terrain height, ridden as ground: land on it, ride it, drop
off the edge. The snow mesh is drawn without it (`terrain.snow`).

Roof probe, 9° slope, 6 m hut: dropped on at 8 m/s, clean on the roof, 1 s on it, off the edge,
clean on the snow; riding alongside 0.2 m from the side, no snap up onto the roof; square into
the side or the uphill end, bonk.

Decided while building: catching the face turns `panel.climb` (0.7) of the speed into it up the
face, as a transition would — without it a wallride only slid along the foot. Leaving the face
without a pop rolls the board level, nose along the travel; over the top it keeps its attitude.
A pop goes out and up at 45° (`panel.popUp` 1). A soft touch into a face pushes you off it;
past `panel.bonkSpeed` (3 m/s into it) you bounce off and go down.

Probe, 9° slope, panel 2.5 m: 20° in at 10 m/s, ~1 s on the face, 1 m up, lands clean; 40° in,
up to the top edge and off, clean; square in, bonk; 4 m/s, slides past; pop off, clean; steering
up or down the face, both land; a building's side at 25°, 1 s on it, 1.6 m up, clean.

Not yet: steps 4 (taps), 5 (balance on the face, sound per material, posture), 6 (generator,
editor). Defaults taken for the open questions below: gravity 0.35, no balance, one material
(plywood), the snow wall kept.

## 1. What a built wall is

| Field | Meaning |
|---|---|
| `x, z, yaw, length` | Base line on the snow: start point, direction, length |
| `height` | m, face from its foot to the top edge (park walls 1.5–3 m; tombstone 1–2 m) |
| `lean` | rad back from vertical, away from the riding side (0–20°; 0 = vertical) |
| `side` | which face is ridden (±1), or both |
| `material` | `wood`, `metal`, `concrete`: friction, sound, look |
| `ramp?` | snow ramp at the foot on the riding side: `height`, `length` (a transition up to the panel) |
| `foot` | m the panel's bottom edge sits above the snow (0 = on it; > 0 = raised, ramp needed) |

The panel itself is one plane. The ramp is ordinary snow terrain (a shape in the heightfield),
so getting onto the panel can be riding up the ramp, or an ollie into it.

**Variants, all the same object:** straight wallride; leaning wallride; tombstone (short, tall,
for taps); wallride with a ramp on both ends; two panels at an angle (a corner).

## 2. Sim

New state `walled` in `src/sim/states/walled.ts` (CLAUDE.md already lists it), panels in
`src/sim/walls.ts` beside `rails.ts`.

**Capture**, from the air or off the ramp, every tick the rider is near a panel:
- board within `panel.captureDist` of the face, inside its length and height, on the ridden side;
- moving into the face, not away from it;
- travel within `panel.captureAngle` (~55°) of the panel's run — a glancing approach is a ride;
- speed above `panel.minSpeed`.

Fail the angle (square into it) and it's a **tap** if the contact is short and the speed into
the face is under `tap.maxImpact`: velocity into the face reflected × `tap.restitution`, rider
stays airborne. A tap was §17's open question ("needs a new contact rule"); it falls out of
the panel here. Harder than that: a bail.

**On the panel** — position held on the face (like a rail holds you on its line):
- board up = panel normal; heading along the panel, the way you were travelling;
- gravity × `panel.gravityScale` (today's `wall.gravityScale`, 0.35 — keep) pulling down the face;
- speed bleeds at `panel.friction[material]` (wood slides, concrete grabs) plus air drag;
- left stick: lean on and off the face — a balance like the rail's, softer (`panel.instability`),
  so a long wallride is a hold, not free;
- the existing hysteresis carries over: get on at `minSpeed`, let go below `exitFraction` of it.

**Ways off:**

| Exit | What happens |
|---|---|
| Off the end | airborne, carrying speed along the run |
| Over the top edge | airborne: up and over, or back down onto the riding side (the pipe-coping case) |
| Too slow / let go | slide down the face to the snow: a landing judged as usual |
| Pop (RT) | impulse along the panel normal + up: a wallie off it; spin set as at any pop |
| Lean lost | off the face and down: bail |

Pop off a wall: the plain pop must land at least sketchy-safe. The snow wall's pop came out 49°
off travel, one degree from a bail; with the panel's normal mostly horizontal that gets worse,
so the pop direction blends toward up (`panel.popUp`) — the earlier open question, answered here.

## 3. Render

- Panel mesh: the face, a frame round it, posts or a back brace, a top cap. Colours per
  material, no textures (fits the look). Ramp is snow, drawn by the terrain as now.
- No spray on the panel. Sound: a different layer per material (wood thud and scrape, metal
  ring), and a tap is a knock.
- Rider: board against the face, body leaning off it — the carving posture with the face as the
  "snow", so angulation reads the same way.

## 4. Data, editor, generator

- Park JSON: `panels` entries (new), stored in takes like rails. Old takes keep `walls` (the
  snow bank) and replay unchanged.
- Editor (`?edit=1`): a `wallRide` kind places a panel and its ramp; gizmo for yaw and length.
- Generator: `designWallRide` builds a panel + ramp beside the approach, angled 15–35° off the
  line so it's ridden on a glancing approach; `tombstone` as its own kind, low odds.
- Talma: the wall and bank line's snow wall becomes a 2.5 m plywood panel with a ramp.

## 5. Build order — each step ridden before the next

1. **Panel geometry and render**, no sim: panels in the park JSON, drawn. Talma gets one.
2. **Capture, ride, and the exits** (`walled.ts`): off the end, too slow, over the top. Probe:
   chained entries from a ramp and from an ollie, no flicker, no speed jumps (milestone 6 gate).
3. **Pop off and the landing**: plain pop lands at least sketchy-safe.
4. **Taps** (tombstone): short contact, restitution, bail past `tap.maxImpact`.
5. **Balance on the face**, sound per material, rider posture.
6. **Generator and editor.**

Milestone 6's gate ("wallrides and butters chain into and out of other states without a hitch")
is judged after step 3, on built walls.

## 6. What happens to the snow wall

`WallConfig` stays as terrain — a snow bank, halfpipe sides — renamed in the docs to "snow
wall" and dropped from the wallride role. The surface rule (`walled` on snow steeper than
`wall.minAngle`) stays for those, and keeps the exit hysteresis just added. If you'd rather it
go entirely, it can, once Talma and the generator use panels.

## 7. Open — your call

1. **Gravity on the panel.** 0.35 of real makes long wallrides easy and is the snow wall's
   number. Real riders carry a wallride on momentum. Start at 0.35 and tune, or start real (1.0)?
2. **Balance on the face**: a lean to fight like a rail, or none (the board just rides)?
3. **Materials**: three (wood, metal, concrete), or one until it plays?
4. **Snow wall**: keep for halfpipe sides and natural banks (§6), or remove?
