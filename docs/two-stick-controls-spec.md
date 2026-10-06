# Two-stick controls — spec

A remap of the pad so the **left stick is the upper body** and the **right stick is the
lower body**, borrowing what works in Shredders and dropping what doesn't. It replaces
design §2 once built. The physics under it (§4–§9) mostly stays; this changes what reads
which input.

Kept from Shredders: the stick split, ollie/nollie from the right stick at the pop, a
press you can hold through the wind-up and pop out of, landing into a press, grabs that
speed up or slow down the spin.

Rejected: a fixed amount of spin per flip (their 540° per flip), inputs that only work in
a strict order, and separate tuck/open/land buttons. Rotation here is always angular
momentum from the wind-up and the pop, changed in the air only by body shape.

---

## 1. The split

| | Left stick — upper body | Right stick — lower body |
|---|---|---|
| Idea | Shoulders, arms, where you look | Hips, knees, feet: weight along the board, the board under you |
| Grounded | X edge / turn · Y tuck (fwd) or stand tall (back) | Y nose / tail press · X skid |
| Charging RT | X winds up the spin (counter-rotation) · flick Y sets a flip | Y picks ollie, nollie or flat pop |
| Airborne | Toward the spin: tuck, spins faster · against it: open, slows · centred: check | With L1/R1: grab. Alone: X shifty, Y the press you land into |
| Railed | Balance lean across the rail | Y moves the contact point: nose / tail press · X unused |
| Landing window | — | Revert / save (as now) |

Triggers and buttons:

| Input | Grounded | Airborne | Railed |
|---|---|---|---|
| RT (analog) | Compress; release = pop. Held in a press = locks the press | Absorb: legs ready for landing | Compress; release = pop off |
| LT | Unassigned (see §9) | — | — |
| L1 / R1 | — | Grab hand (front / back) with right stick | Turn slide angle |
| Y / Triangle | Reset | Reset | Reset |

---

## 2. Grounded: carving and speed

- **Left stick X — edge.** Unchanged: edge target, carve is velocity rotation (§4).
- **Left stick Y — posture, the speed control.**
  - Forward: tuck. Knees and chest down, drag × `ground.tuckDrag` (< 1), carve radius a
    little wider (`ground.tuckCarve`). This is how you carry speed into a feature.
  - Back: stand tall. Drag × `ground.tallDrag` (> 1), carve tighter. A soft speed check
    without skidding.
  - Analog both ways. Truth: you don't speed up by pushing a button, you stop losing it.
- **Right stick X — skid.** The lower body kicks the tail out: grip drops, the board
  swings across the direction of travel toward the stick side, speed bleeds through the
  existing edge drag. Combined with left stick back it is a hard stop. Replaces LT brake.
- **Right stick Y — press.** Weight toward the nose (up) or tail (down). Becomes `stance`,
  which today comes from left stick Y. Past `butter.press` it is a butter (§5).

The skid and the press share a stick on purpose: a diagonal is a pressed slash, which is
real.

## 3. Pop: ollie, nollie, flat

RT held compresses as now (`pop.chargeTime`, `pop.decay`). At release the right stick Y
picks the pop:

| Right stick Y at release | Pop | Height | Takeoff pitch |
|---|---|---|---|
| Down (tail) | Ollie | × `pop.ollieGain` (highest) | Nose up |
| Centred | Flat pop | × 1 | None |
| Up (nose) | Nollie | × `pop.nollieGain` (between) | Nose down |

Replaces the symmetric `pop.stanceBias`, which makes a nollie 30% weaker than a flat pop.
Real nollies are weaker than ollies, not weaker than nothing. Analog in between.

The pop reads the **press already held** (`stance`, which follows the stick at
`ground.stanceResponse`), so a tail press into a pop is an ollie without moving the thumb,
and a quick push down just before release mostly counts too.

## 4. Rotation — no fixed amounts

Spin model 1 (§5, `air.spinModel`) stays. Only the inputs move.

**Spin (left stick X).** While RT is held, push the stick *against* the spin to wind up
the shoulders; the board holds its line (`air.windSteer`). At release, point it *toward*
the spin to send it. Wind-up time sets how much (`air.windTime`), how far you point sets
the flick (`air.flickGain`). Nothing is quantised: a half wind-up is a half wind-up.

**Flips (left stick Y, a flick).** A flip is the shoulders thrown forward or back at the
pop. Because left stick Y is now also the tuck, flips read **stick travel in the last
`air.flickWindow`**, not position, the same way the carve is discounted from the spin.
A held tuck pops straight; a flick back at the pop is a backflip. The stick at the pop is
a rotation vector, as now: X spin, Y flip, a diagonal a cork, longer air a double.

**Lower body adds to it.** An ollie pitches the nose up and a nollie pitches it down
(§3), so a backflip off an ollie, or a frontflip off a nollie, comes round faster than the
other way. That falls out of adding the pop's pitch to the flip; no special case.

**The amount of rotation is momentum × body shape × air time.** No rule says "a cork is
540". A dub 9 or a cork 180 is whatever wind-up, flick and air time produced it.

**In the air (left stick):**

| Stick | Body | Spin |
|---|---|---|
| Toward the spin | Tuck — arms in | × up to `1 + air.tuckGain` |
| Centred | Neutral | Checked toward rest at `air.checkRate` |
| Against the spin | Open — arms out, counter-rotating | × down to `1 − air.openGain` |
| Y held | Keeps the cork / flip axis | Centring Y comes out of it (`air.corkRecover`) |

**Slow spins: pre-rotation.** A big jump gives 1.5–2 s of air, so a 360 needs a third of
the rate a park kicker does. A whip can't hit that reliably: the smallest flick is already
`flickGain` (half) of full spin. Riders set slow spins differently: shoulders turned *the
way of the spin* before the lip and held, the board following them round. Counter-rotation
is the snap, pre-rotation the slow, even turn.

| Gesture | Spin |
|---|---|
| Wind against, point toward at the pop (counter-rotation) | Fast. As above |
| Stick held toward the spin through the charge **and through the pop**, only RT let go (pre-rotation) | Slow, even. Rate = held deflection × wind-up time × `air.preRotateGain` (~0.4 of `spinTakeoff`) |
| Centred | Straight air |

- **Off-axis is the held direction.** The whole held stick sets the axis, the way a flicked
  one does: X held is a slow flat spin, Y alone a slow off-axis flip, a diagonal a slow
  cork. The flip part scales down with the spin part, so a slow cork 540 is slow on both
  axes, not a slow spin with a fast flip bolted on. In the remap the right stick held
  with it adds the pop's pitch (§3), so both sticks held down-and-across are the slow cork.
- **More in the air by tucking.** Held toward the spin in the air is the tuck (above), so
  a slow 360 set on the lip turns into a 720 by keeping the stick there, and comes back to
  a 540 by opening. Nothing rounds it.
- **Replaces "held against through the pop = straight air".** With pre-rotation, a held
  stick means a slow spin that way. A straight air is a centred stick, which it already is.
- **Wind-up direction.** Today the stick held during the charge loads a wind-up for the
  *opposite* spin. Under pre-rotation, what the pop does with it depends on what the stick
  does at release: reversed (sent) is counter-rotation, still held is pre-rotation the held
  way. One stored wind-up, read two ways at the pop. No timing or order rules beyond that.

Never snap rotation in flight. The landing test (§6) decides.

## 5. Butters

- **Enter:** right stick up or down past `butter.press` at butter speed. Left stick X then
  pivots the board on the pressed end (`butter.yawRate`): shoulders lead, the board follows.
- **Lock:** holding RT while pressed holds the press at its current `stance` even if the
  thumb drifts, so the left stick is free to wind up a spin. Release RT = pop out.
- **Pop out of a press:** a nose press pops as a nollie, a tail press as an ollie (§3).
  The butter's yaw rate at release is added to the spin, so buttering into a pop spins
  further than a cold pop with the same wind-up. Truth: the board is already turning.
- **Flip out of a press:** a left stick Y flick while popping from a locked press. Same
  rule as §4, no special case.
- **Land into a press:** right stick held up or down at touchdown lands on that end,
  straight into a butter; spin left over at contact carries into the butter pivot through
  the existing skid carry (`land.skidCarry`). Landing test unchanged: the board still has
  to line up.
- **Exit:** centre the right stick.

## 6. Grabs change spin speed

Today any grab multiplies spin by `air.tuckMultiplier` (1.25), and tweak depth moves it
toward `air.extendMultiplier` (0.85). Replace the flat number with one that comes from
**how compact the grab makes the body**, read from the grab coordinate (§7.3), not from
the grab's name, so grabs stay emergent:

- **Between the feet** (melon, indy, stalefish: `grabT` near the middle): body folded,
  arms in → faster. × `air.tuckMultiplier` (1.25).
- **At the tips** (nose, tail): body stretched along the board → about neutral.
  × `air.tipMultiplier` (1.0).
- **Tweak depth** pulls it toward `air.extendMultiplier` (~0.8): a method or a tweaked
  mute shoves the board out and slows the spin, which is why riders don't method big
  spins.
- Interpolated by `grabT` between mid and tip, then by tweak. Ramps in with `grab.grip` so
  catching a grab mid-spin speeds up smoothly, not on one tick.

The left stick tuck (§4) multiplies on top, so a tucked indy is the fastest shape and an
open, tweaked method the slowest.

## 7. Rails

- Left stick: balance lean across the rail (the heel/toe term of the current trick model).
- Right stick Y: contact point along the board, nose to tail press. Today both come from
  the left stick projected by slide angle; splitting them makes a press independent of
  the balance fight, which is how it feels on a real rail.
- L1/R1: slide angle, as now.
- Spinning off: as on snow (§4). Off-balance or pressed reduces the spin the pop can send
  (`rail.offBalanceSpin`), which is real and matches Shredders, but as a scale, not a
  block: you get a smaller spin, not none.

## 8. Carving posture

Render only. Legs and torso do different jobs in a turn: **the lower body angulates into
the turn and holds the edge; the upper body stays more upright to balance against the
load.** Today the rig shifts the hips toward the edge in proportion to edge angle
(`rig.edgeHipShift`) and turns the shoulders into the turn (`rig.carveLead`). The body
leans as one block, and the same way on toe and heel.

All of it is driver-vector output (design §7.2) on springs (§7.6), read from state the
sim already has. No clips.

**Inputs**, all from state or derived in render:

| Input | From |
|---|---|
| Edge, signed toe/heel | `state.edge` |
| Turn rate | Heading change per tick, as `carveLead` already reads it |
| Lateral load, in g | speed × turn rate / g. What the body actually balances against |
| Posture | Left stick Y (§2): tuck / tall |
| Skid, press | Right stick X / Y (§2) |

**Built** (render-only, `rig.*`). Load is the loose body's smoothed acceleration across
the board (`secondary.accX`) over `rig.carveLoadFull` (0.25 g: the sim's hardest carves
pull 0.2–0.3 g), signed + heelside, − toeside. Takes recorded before it replay with the
crouch and head look off.

**1. Load sets the depth.** Hips drop by `rig.carveCrouch` × |load|. A hard carve folds
you; a lazy one leaves you standing. Edge angle alone doesn't: a high edge at walking
speed carries no load, so no crouch.

**2. Angulation: legs in, torso out.** The board's edge roll (`rig.edgeRoll`) already
tips the whole rider into the turn. Inside that, the torso tips back toward the outside
by `rig.angulation` × load (as `spineBend`), so the legs lean further than the chest.
`rig.edgeHipShift` stays as the static part.

**3. Toe and heel turns look different.**

| | Heelside | Toeside |
|---|---|---|
| Hips | Toward the heel edge and down: sitting into it (`rig.heelSit`, `rig.heelSitDrop`) | Stay over the board, a touch toward the heel (`rig.toeHipBack`) |
| Knees | As the crouch puts them | Turned toward the toes, driven at the snow (`rig.toeKneeDrive`, lowers `kneeSplay`) |
| Torso | Folds forward over the toes (angulation, +) | Tall, chest up (angulation, −) |
| Arms | Forward, counterweight to the sit (`rig.heelArms`) | Riding arms |

Blended by the sign and size of the load, so the edge change is a continuous swap.

**4. Up and down between turns.** No separate rise: the load passes zero between turns,
so the crouch lets go and you extend, then sink into the next one. Above
`rig.crossUnderSpeed` (faded in over `rig.crossUnderFade`) the hips hold
`rig.crossUnderHold` of the full crouch between turns: low body, legs swinging under it.

**5. Order: shoulders, then hips, then board.** Shoulders turn first (`carveLead`, kept),
the hips follow on their springs, the board's edge roll last. The head looks
`rig.carveLook` seconds along the turn (within `rig.headTurnMax`), not along the board.

**6. Arms at high load.** Past `rig.handDragLoad` of full load the trailing hand swings
toward the snow on the inside (behind on heelside, over the toes on toeside) by up to
`rig.handDrag`, and the lead arm lifts half that the other way. Riding switch the trailing
arm is the front one.

**7. The new inputs, drawn** (waits for the remap).
- Tuck (left stick forward): hips down, chest folded over the knees, arms in. Stand tall:
  the reverse.
- Skid (right stick X): hips back over the tail, upper body stays facing down the fall
  line while the board swings across. Counter-rotation against the skid, the same rule as
  the spin wind-up.
- Press: as now (`rig.stanceHipShift`, `rig.stanceSpineSide`).

**Tuning.** Ride, or replay a fresh take, with the `rig` folder open: all of it is render,
so sliders change the look without touching the sim. Set heelside and toeside at full
load first. Not built: a pose-mode preview with a fake load, which would let carves be set
against video without riding. Add it if tuning on the hill is too slow.

## 9. Not decided — resolve by play

1. **LT.** Freed by moving the brake to the right stick. Candidates: a crossed-grab
   modifier (design open question 6), or nothing. Leave it empty until something earns it.
2. **Right stick in the air without a bumper.** Shifty and board pitch is the proposal.
   If it fights grabs (thumb already on the stick before L1/R1), make it shifty only.
3. **Edge on the left stick.** Real edging is ankles and knees, the lower body. It stays
   on the left stick because the right stick has to be free for press and pop, and
   because the shoulders really do lead a carve. Flag it if carving feels detached.
4. **Flip flick vs. tuck.** If tucking into a kicker still throws unwanted flips, raise
   the flick threshold before anything else.
5. **Pre-rotation vs. a carve into the lip.** Holding the stick toward the spin while
   charging is also a carve. If slow spins start from carves nobody meant as spins, require
   RT held for a minimum time before a held stick counts as pre-rotation.

## 10. Building it

**Status.** Built: §2–§6 on snow and in the air, §8, and the posture and skid drawing.
Not built: §7 rails (still the one-stick weight shift), pre-rotation (§4), right stick Y
as board pitch in the air (it is the press you land into instead).

- **Takes still replay.** One switch, `input.scheme` (0: one stick, 1: two sticks, the
  default), recorded in the take's params. Takes before it replay on 0 bit-identically;
  their stored sim hashes were re-hashed for the two new state fields (`flipRef`,
  `posture`). `takes/two-stick.json` (`scripts/make-two-stick-take.ts`) covers scheme 1 in
  `npm run determinism`.
- Params: `input.scheme`; `ground.tuckDrag`, `ground.tallDrag`, `ground.tuckCarve`,
  `ground.tallCarve`; `pop.ollieGain`, `pop.nollieGain`, `pop.flipAssist`;
  `air.tipMultiplier`, `air.grabSpinByPlace`; `butter.popCarry`; render `rig.tuckDrop`,
  `rig.tuckFold`, `rig.tallRise`, `rig.tallFold`. The skid reuses `ground.brakeDecel` and
  `ground.brakeGripLoss`.
- Still to come: `rail.offBalanceSpin` with §7, `air.preRotateGain` with pre-rotation (old
  takes replay with it 0, which is today's straight air).
- Butter lock and the wind-up: while RT is held the left stick mostly loads the wind-up
  (`air.windSteer`), so a locked butter pivots slowly and little of its pivot is left to
  carry at the pop (~0.7 rad/s in a probe). The spin out of a butter comes mainly from the
  wind-up. Raise `butter.popCarry` or `air.windSteer` if it should carry more.

**What to tune first, by hand:** `pop.ollieGain` vs `pop.nollieGain` (the pop feel),
`ground.tuckDrag` / `ground.tallDrag` (does posture feel worth it — in a probe, 8 s down a
gentle slope, tuck vs. tall was only 10.9 vs. 10.4 m/s, because air drag is small below
~15 m/s), `air.tuckMultiplier` vs `air.tipMultiplier` and tweak (does a grab
change the spin enough to feel it, not so much it decides the trick), `rig.angulation`
(legs vs torso: too low reads as a stiff lean, too high as a broken back).
