# Camber — Talma-style Reference Park

Oct 5, 2026 · @Kalle

## Overview

Camber's first hand-built park, modelled on Talma Ski (Sipoo, Finland): a small hill dedicated to park riding, known for fast laps and dense, well-shaped features. It's a better first target than an Olympic slopestyle: small enough for one browser scene, dense enough for many lines, with a beginner and an advanced version of each zone.

**What's sourced (public info):**

- Hill: 55 m greatest vertical drop, longest slope 450 m, two snow parks, a halfpipe.
- Lap: about 1 min 30 s from bottom to top.
- Advanced setup: halfpipe, kicker line with three jumps, big air jump, rail garden with three lines.
- Beginner setup: kicker line with three small jumps, rail garden with three lines.
- Built with a Leica survey system to centimetre precision.

**From local knowledge (Kalle) and a drone photo of the hill:** the lifts run up the centre. Left of the lifts, three park lines run side by side down the full hill: the jump line next to the lifts, then two rail lines further left. Every jump has a small and a big takeoff side by side with a shared landing. Right of the lifts is a groomed run with no features. The halfpipe starts at the top, just above the rail lines, and runs about 90° off to that side (rider's right going down, left as seen from the bottom), on its own face. The big air is on a separate slope on the backside. In the photo the park looks terraced: wide, flat decks between steeper drops, with rails and boxes set on the decks.

**What's assumed:** Talma doesn't publish feature dimensions or a park map with sizes. Feature sizes below come from comparable European park setups (e.g. Kitzsteinhorn: 2–4 m and 4–6 m kickers, 4–8 m rails and boxes) and Camber's own size presets. Replace them with measurements if you ride or film Talma.

## Hill dimensions

|  | Talma (sourced) | Camber reference park |
| --- | --- | --- |
| Vertical drop | 55 m (greatest) | 60 m |
| Slope length | 450 m (longest) | 400 m |
| Average gradient | \~7° over the longest run (derived) | \~9° overall, park sections 10–14° |
| Width | not published | \~90 m: park \~50 m (jump line 20 m, two rail lines \~15 m each) + groomed run \~35 m; pipe and big air on separate faces |
| Lap | \~1.5 min bottom to top | \~45–60 s ride + instant lift (respawn at top) |

- Talma's 7° average is mellow; park sections are steeper and connect with flatter run-outs. Camber uses steeper park sections than the average so jumps get enough speed without long run-ins.
- 60 m of vertical gives a top speed around 15 m/s with friction, enough for an M–L jump at the end of a line. The XL big air needs its own steeper run-in (14–16°).

## Zone layout

&#91;image: Talma Ski from the bottom of the hill: park lines left of the lifts, groomed run right\]

*Reference photo (drone, from the bottom). Lifts up the centre; jump line, rail line 1 and rail line 2 to their left; groomed run to the right; red fencing along the park edge.*

&#91;embedded content: reference park zones, plan view\]

Three park lines run in parallel down the left half of the hill, left of the lifts: rail line 2 (outer), rail line 1, and the jump line next to the lifts. Each line runs the full height, so a lap is one line top to bottom, and riders can switch lines on the flat decks between drops. The right half is a plain groomed run. The halfpipe and big air are separate areas: the pipe on its own face, starting at the top just above the rail lines and turning about 90° off to that side, the big air on a slope on the backside of the hill.

&#91;embedded content: reference park, view from the bottom\]

If you know Talma, comment on this view: which zone sits where, which way the lines run, and where it differs from the real hill. Those corrections are worth more than any of the assumed sizes.

## Features by zone

Sizes are starting values (assumed, see Overview). Designs and parameters follow the Jump Designs Spec; rails follow the Feature Catalogue.

**Rail line 1 (inner, next to the jump line; straight, flat-down, rainbow)**

| Feature | Design | Size (estimate) |
| --- | --- | --- |
| 1 | Straight down rail | 6–8 m, follows a drop |
| 2 | Flat-down rail | 3 m flat + 5 m down, kink at the deck edge |
| 3 | Rainbow rail | 6 m, arched; on a flat deck with raised snow ramps at both ends (\~0.5 m); peak 0.5–0.8 m above the ends |

**Rail line 2 (outer; kinked rails) and big air (backside slope)**

| Feature | Design | Size (estimate) |
| --- | --- | --- |
| 1 | Down rail with flat end | 6 m down + 1.5–2 m flat at the bottom |
| 2 | Down-flat-down kink rail | 4 / 2 / 5 m |
| 3 | Flat-down-flat kink rail | 3 / 5 / 3 m |
| Big air | Big-air kicker, XL preset | 15–18 m table, lip 3 m, dedicated steeper run-in |

**Rail rules:** each rail is a spline of segments (flat, down, arc) with kinks between them. The rail classifier (Trick Input spec) keeps the slide type through kinks; a kink is scored as a transition when the rider stays locked across it. Rail height follows the terrain under each segment: about 0.4–0.6 m above the snow, measured perpendicular to it.

**Jump line (shared, spans both zones)**

| Feature | Design | Small takeoff | Big takeoff | Shared landing |
| --- | --- | --- | --- | --- |
| Jump 1 | Split kicker | lip 0.8 m, table 4 m | lip 1.5 m, table 8 m | solved for the big takeoff |
| Jump 2 | Split kicker | lip 1.0 m, table 5 m | lip 1.8 m, table 10 m | solved for the big takeoff |
| Jump 3 | Split kicker | lip 1.0 m, table 6 m | lip 2.2 m, table 12 m | solved for the big takeoff |

**Split kicker rule:** both takeoffs end at the same knuckle line. The landing is solved for the big takeoff's arcs (constant EFH). The small takeoff is then placed and sized so its arcs at its own design speed land within the upper part of the same landing with EFH at or below target; the generator searches small-lip height and table length to meet that. Takeoffs sit side by side, 2–4 m apart, small one on the side nearer the beginner rail garden.

**Halfpipe (25 m wide)**

| Feature | Design | Size |
| --- | --- | --- |
| Halfpipe | Park pipe | 3.5–4 m walls, 12 m flat bottom, \~100 m long, pitch \~16° |

The halfpipe needs wall-mode physics (Jump Designs Spec, Walls). Until that exists, leave the zone in place as terrain and add the pipe later.

## Side profiles

&#91;embedded content: jump and rail lines, side profiles\]

- **Terraces:** every line steps down the hill as deck, drop, deck, drop. Decks are near-flat (0–5°); drops are steep (25–35°). Decks line up across the three lines so riders can switch lines on them.
- **Jump line:** each jump is a tabletop: kicker at the start of a deck, the rest of the deck is the table, and the next drop is the landing. The small takeoff sits alongside the big one with a lower lip, landing higher on the same drop.
- **Rail line 1:** straight down rail on a drop; flat-down rail starting on a deck and following the drop; rainbow rail on a flat deck, with raised snow ramps at both ends: a lifted takeoff to ollie onto it and a lifted landing to ride off.
- **Rail line 2:** straight down rail on a drop with a short flat kink at the bottom, where the drop meets the next deck; down-flat-down kink rail on a drop; flat-down-flat kink rail from a deck over a drop to the next deck.
- **Rail height:** 0.4–0.6 m above the snow under each segment.

## Flow, spacing, lap time

- **Parallel lines:** jump line and two rail lines side by side, each full height. Order left to right: rail line 2, rail line 1, jump line, lifts, groomed run.
- **Terraces:** each line is a sequence of steeper drops and flat decks. Jumps use the drops as landings; rails and boxes sit on the decks. Decks line up across lines so riders can switch.
- **Spacing in the jump line:** 25–40 m from one landing's bottom to the next lip. Each landing's outrun delivers the next jump's design speed (Terrain spec line rule).
- **Rail lines:** 3–4 features each, alternating rails and boxes, one per deck.
- **Lap:** 45–60 s of riding top to bottom, then instant respawn at the top (Talma's fast-lap feel without simulating the lift).
- **Separate areas:** halfpipe on its own face from the top, big air on the backside slope; both reached from the top, not part of the main lap.

## Atmosphere

Stylised, not a replica: a few signature details make the park read as Talma to anyone who knows it. No Talma logo or name on in-game signs; use a fictional name such as "Sipoon Alpit" (a nod to its "Sipoo Alps" nickname).

| Element | Look | Priority |
| --- | --- | --- |
| **Flat horizon** | No mountains. Low forested ridges, farmland and villages in the distance; skybox plus low-poly distant forest. | 1 |
| **Low winter sun** | Bright, low sun; long cool-blue shadows across corduroy. One light angle and shadow colour do most of the work. | 1 |
| **Red safety fencing** | Along the park edge and the lift line. | 2 |
| **Button lifts** | Old aluminium one-person button (platter) lifts up the centre: towers carrying a single cable line, a row of hanging telescopic poles with round discs, evenly spaced and swaying slightly. Not T-bars. | 2 |
| **Night mode** | Tall floodlight masts along the lift line; pools of light with darker gaps between them. Talma is known for night riding. | 3 |
| **Spruce edge** | Dense, snow-loaded spruce along the left side, birches mixed in lower down. | 3 |
| **Small details** | Red snowcat parked or grooming in the background; small base hut at the bottom; a few coloured boxes (blue, as in the photo). | 4 |

- **Respawn:** the rider rides up on a lift pole as the respawn animation (skippable), keeping the fast-lap feel.
- **Ambient life:** occasional riders on the lift and a groomer moving on the groomed run; no collisions with them.

## Build steps and Claude Code prompt

1. **Terrain:** 400 m × 90 m main face plus a side face for the pipe and a backside slope for the big air, 60 m vertical; flatter top strip, park sections 10–14°, steeper run-in for the big air.
2. **Jump line with split kickers** first: the main test bed for jump feel and EFH landings.
3. **Both rail lines on the terrace decks.**
4. **Big air** with its run-in.
5. **Cross-overs and side hits.**
6. **Halfpipe zone** once wall mode exists.
7. Atmosphere: horizon and light first, then fences and button lifts, then night mode and details. **Save as** `/parks/talma-reference.json` and make it the default park.

**Prompt:**

```
Read docs/talma-reference-park.md, plus docs/jump-designs-spec.md, docs/feature-catalogue-spec.md and docs/terrain-spec.md for context.

Build the Talma-style reference park as a hand-built layout: step <STEP> of the build steps.

Rules:
- Use the existing feature generators and size presets; this task is a layout, not new generators. If a feature can't be built from existing blocks, stop and tell me.
- Terrain and zone sizes as in the spec; all feature sizes as listed, tuned only through parameters.
- Validate every kicker line with the speed check: each feature reached within its design speed range when ridden without braking.
- Output the park as layout JSON at /parks/talma-reference.json and load it as the default park.

Start in plan mode. After building, tell me which features failed the speed check and what you changed.
```
