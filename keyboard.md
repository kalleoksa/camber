# Keyboard input — plan

Status: planned, not implemented. Fallback for playing without a pad (laptop). The pad
stays the reference device; gates and tuning are done on the pad.

---

## 1. Scope

- New `src/input/keyboard.ts`: tracks held keys, writes the same `InputSnapshot` as
  `pollGamepad`.
- `main.ts` `step()`: poll both, merge per field — larger magnitude wins for axes,
  OR for buttons. Pad and keyboard work at the same time.
- Sim, recorder, takes: no change. The recorder stores the snapshot, not the device, so
  keyboard takes replay deterministically as they are.
- No dependency.

## 2. Mapping

| Key | Snapshot | Grounded | Airborne | Railed |
|---|---|---|---|---|
| A / D | `lx` | Edge | Spin | Balance |
| W / S | `ly` | Nose / tail press | Flip; with A/D, cork | Press |
| Space | `rt` | Compress; release = pop | Absorb | Compress; release = pop |
| Shift | `lt` | Scrub | — | — |
| Q / E | `lb` / `rb` | Pivot | Shifty | Slide angle |
| Arrows | `rx` / `ry` | — | Grab position | — |
| Alt + arrows | `rx` / `ry` at full | — | Grab + tweak | — |
| F | `a` | — | Bail | — |
| R | `y` | Reset | Reset | Reset |

Grab: arrows alone give magnitude `input.keyGrabReach` (below `grab.tweakEnter`, 0.55),
so the hand catches without tweaking. Alt pushes to 1 — past `tweakEnter`, so it tweaks.
Diagonals are normalized so they don't reach further than straight.

Existing keys kept: `[` `]` step anchors in pose mode.

**Two sticks** (`input.scheme` 1, the default; docs/two-stick-controls-spec.md): W/S are
left stick Y — tuck / stand tall on the snow, a flip when flicked at the pop. Arrows
without Q/E are the whole right stick: ↑↓ press (and ollie / nollie at the pop), ←→ skid
on the snow, shifty in the air, revert and save in the landing window. With Q or E held
they grab, as above; Shift deepens it to a tweak. Shift alone (LT) does nothing.

## 3. Digital → analog: the ramp

Keys are on/off; most inputs here are analog. Each keyboard axis ramps toward its
target instead of snapping:

```
target = (posKey ? 1 : 0) - (negKey ? 1 : 0)
value  += clamp(target - value, ±rate·dt)
rate    = rise when |target| > |value|, fall otherwise
reverse (A held while value > 0): snap through 0 first — a counter-steer shouldn't wait
```

Run on the fixed tick, not per render frame, so ramp shape doesn't depend on frame rate.

Why each axis needs it:

- `lx` — edge angle is a target. Snapping to 1 makes every carve a full carve. Rise
  rate sets how quickly the rider gets on edge; this is the main keyboard feel number.
- `ly` — cork vs. flip hinges on `air.corkDeadzone`. A slow `ly` rise lets a short tap
  stay a press without triggering a flip.
- `rt` — `pop.chargeTime` already makes the charge build over time, so Space can snap
  to 1. No ramp.
- `lt`, buttons — snap.

## 4. New params

Input-side, like the pad deadzones, but they set feel, so by the CLAUDE.md rule they go
in `params.ts` (new `input` group) and get Tweakpane bindings in the same commit.

| Param | Start | Unit |
|---|---|---|
| `input.keyEdgeRise` | 4 | 1/s, `lx` toward target |
| `input.keyEdgeFall` | 8 | 1/s, `lx` back to 0 |
| `input.keyStanceRise` | 3 | 1/s, `ly` toward target |
| `input.keyStanceFall` | 8 | 1/s, `ly` back to 0 |
| `input.keyGrabReach` | 0.45 | stick magnitude for arrows without Alt |

Takes carry params, so old takes pick up these values through `withDefaults` without
issue — the sim never reads them.

## 5. Housekeeping

- Ignore key events while focus is in a Tweakpane field or other input.
- `preventDefault` on game keys (Space scrolls the page, arrows too).
- Clear all held keys on window `blur` and `visibilitychange`, or keys stick down.
- Readout `pad` line: show `keyboard` when keys are the active source.
- Use `KeyboardEvent.code` (physical position), not `key`, so WASD works on
  non-QWERTY layouts.

## 6. Risks

- **Rollover / ghosting.** Worst case holds 4+ keys (W + D + Space + arrow). Many
  cheap keyboards drop keys past 2–3; Mac built-ins are mostly fine. Can't be fixed in
  code, only by changing the mapping.
- **Tuning bleed.** If sim params get tuned to make the keyboard feel right, the pad
  gets worse. Keyboard feel is tuned only through the `input.key*` ramps.
- **Grab resolution.** 8 directions and two reach levels instead of a continuous
  coordinate. Grabs between the 8 points (e.g. a late tail-side method) aren't reachable
  from the keyboard.

## 7. Verification

- Determinism: a scripted take recorded with keyboard input replays identically
  (add to `scripts/determinism.ts` like `rail.json`).
- `npm run typecheck`, `check-math` (keyboard.ts is outside `src/sim`, no ban applies),
  `build`.
- Feel (user): carve both edges, pop, 360, method, 50-50 with keyboard only. Tune the
  five `input.key*` params.

## 8. Estimate

Roughly half a day to write, about an hour of play to tune the ramps.
