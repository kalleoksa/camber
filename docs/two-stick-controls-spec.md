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
| Airborne | Toward the spin: tuck, spins faster · against it: open, slows · centred: check | With L1/R1: grab. Alone: X shifty, Y board pitch (nose up / down) |
| Railed | Balance lean across the rail | Y moves the contact point: nose / tail press · X unused |
| Landing window | — | Revert / save (as now) |

Triggers and buttons:

| Input | Grounded | Airborne | Railed |
|---|---|---|---|
| RT (analog) | Compress; release = pop. Held in a press = locks the press | Absorb: legs ready for landing | Compress; release = pop off |
| LT | Unassigned (see §8) | — | — |
| L1 / R1 | — | Grab hand (front / back) with right stick | Turn slide angle |
| Y / Triangle | Reset | Reset | Reset |

---

## 2. Grounded: carving and speed

- **Left stick X — edge.** Unchanged: edge target, carve is velocity rotation (§4).
- **Left stick Y — posture, the speed control.**
  - Forward: tuck. Knees and chest down, drag × `ride.tuckDrag` (< 1), carve radius a
    little wider (`ride.tuckCarve`). This is how you carry speed into a feature.
  - Back: stand tall. Drag × `ride.tallDrag` (> 1), carve tighter. A soft speed check
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

The pop reads the **press already held**, so a tail press into a pop is an ollie without
moving the thumb. A short flick down in the last `pop.pressWindow` before release also
counts, for a pop from a centred stick.

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
  arms in → faster. × `grab.spinMid` (~1.3).
- **At the tips** (nose, tail): body stretched along the board → about neutral.
  × `grab.spinTip` (~1.0).
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

## 8. Not decided — resolve by play

1. **LT.** Freed by moving the brake to the right stick. Candidates: a crossed-grab
   modifier (design open question 6), or nothing. Leave it empty until something earns it.
2. **Right stick in the air without a bumper.** Shifty and board pitch is the proposal.
   If it fights grabs (thumb already on the stick before L1/R1), make it shifty only.
3. **Edge on the left stick.** Real edging is ankles and knees, the lower body. It stays
   on the left stick because the right stick has to be free for press and pop, and
   because the shoulders really do lead a carve. Flag it if carving feels detached.
4. **Flip flick vs. tuck.** If tucking into a kicker still throws unwanted flips, raise
   the flick threshold before anything else.

## 9. Building it

- **Takes must still replay.** One switch, `input.scheme` (0: today's mapping, 1: two
  sticks), recorded in the take's params like `air.spinModel`. Old takes replay on 0.
- New params, each in `params.ts` and the panel: `ride.tuckDrag`, `ride.tallDrag`,
  `ride.tuckCarve`, `pop.ollieGain`, `pop.nollieGain`, `pop.pressWindow`, `grab.spinMid`,
  `grab.spinTip`, `rail.offBalanceSpin`.
- Update with it: design §2, `render/controlsHelp.ts`, `keyboard.md` (WASD left stick,
  arrows right stick; grabs keep Q/E).
- Milestone note: this touches M2–M6 controls. M5's gate hasn't been played; rails come
  last in the build so the gate is played on one mapping, not two.

**What to tune first, by hand:** `pop.ollieGain` vs `pop.nollieGain` (the pop feel),
`ride.tuckDrag` (does tucking feel worth it), `grab.spinMid` vs tweak (does a grab
change the spin enough to feel it, not so much it decides the trick).
