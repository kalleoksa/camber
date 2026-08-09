# Rig log — what the grab/pose iterations actually taught

Milestone 4 took eighteen commits to get ten anchor poses that are all physically
possible. Most of that was not rig maths. It was the *authoring loop* being wrong in ways
that looked like the poses being wrong, and each one cost several passes to spot.

This file is for the version of me that picks this up in six months and is about to
re-learn one of these the hard way. It is ordered by how much time each cost, not
chronologically.

---

## 1. Posing at the reach limit costs you the arm's route

The single most useful number in the rig is `strain` — shoulder-to-hand distance over arm
length. Above 1.0 the hand cannot touch the grab point.

Every pose authored by hand landed between 0.93 and 1.10. That is not carelessness: a grab
*is* a full extension, so reaching for one naturally puts you at the limit. But it has a
consequence that took a while to see.

Two-bone IK puts the elbow on a circle of radius `sqrt(upper² − (span/2)²)`. At the limit
that circle collapses:

| reach | elbow circle radius | elbow travel across the full swing sweep |
|---|---|---|
| 0.98 | 6.5 cm | 12 cm |
| 0.94 | 11 cm | 22 cm |
| 0.76 | 20 cm | 40 cm |

At 0.98 the arm is a straight line from shoulder to grab point. If a leg is on that line,
the arm goes *through* the leg and no driver can bend it around — this is geometry, not a
missing degree of freedom. A japan's front arm has to pass over the front leg, so a japan
cannot be authored at reach 0.98 at all.

**So: reach is not only a validity test, it is a budget.** Spend some of it or you have no
arm routing. If a pose needs its arm to go somewhere specific, get the shoulder closer to
the grab point first and pose the arm second.

## 2. A missing degree of freedom impersonates a wrong constant

Happened twice, and both times the constant looked *obviously* wrong.

- The arms looked too short, so I lengthened `upperArm`/`forearm` 0.33 → 0.35 on
  "proportions" grounds. What was actually missing was a way for the board to go behind the
  rider's back. Once `boardPitch` existed the original length was fine, and the change got
  reverted.
- Later, three poses independently landed 5–7 cm short of reach 1.0, which pointed hard at
  arm length again. Sweeping it across all eight anchors settled it: clearing every pose
  needs 0.74 m, a 12% increase, and one pose (japan) was forcing that alone. The cost is
  that the seven poses that already closed drop to 0.83–0.88 reach, i.e. visibly slack arms,
  losing the boned look. Wrong trade. **The real fix was a sign error in `spineTwist`.**

Before changing a proportion, ask what degree of freedom would make the current value work.

## 3. Only measure the hand that is actually grabbing

The QA harness exported `strain.front` and nothing else. Three anchors are *back*-hand
grabs (indy, stalefish, tailgrab), so for those it reported the reach of a hand that was
not holding anything — 0.00, which passes every validity test trivially.

`stalefish` sat at **1.40** for several passes, the worst in the set, while the harness
said 0.96. That 0.96 was the free hand.

Any per-side diagnostic needs both sides exported *and* both sides tested, or half the set
is unchecked and looks fine.

**Two more ways the same mistake showed up**, both after this was supposedly learned:

- *Sampling where nothing is under test.* Once `gripDelay` held the grip shut until the body
  was 75% there, a coarse sweep of the transition mostly landed where grip was still 0 — no
  grab constraint, reach reports 0.00, passes for free. Eight clean rows measuring nothing.
- *Losing it to the formatter.* The same sweep printed two decimals, so `mute` peaking at
  **1.0020** mid-transition displayed as a passing `1.00`. Four decimals found it.

A check that cannot fail is not a check. When one passes first time, make it fail on purpose
before believing it — reintroducing the defect is the only proof the test is wired up.

## 4. A number in a panel is not visible

The reach numbers for both hands, with a `SHORT` flag, were printed in the tuning panel the
whole time. Four poses still got authored with a hand past arm length.

That is not a reading failure. It is one text line among a dozen readouts while your eyes
are on the 3D view and your hand is on a slider. It did not start counting until an
unreachable grab turned the arm **red in the viewport**, with a bar spanning the gap.

The panel also now reports the miss in centimetres, not just the ratio. While tuning, the
useful quantity is how much further to go; `8cm SHORT` answers that and `1.12` does not.

**Diagnostics belong where the eyes already are.** If a check only exists in a readout
nobody is looking at, it does not exist.

## 5. Dead sliders look like your own incompetence

Whenever a grip was above 0, the hand was pinned to the grab point and IK solved the elbow
from a pole that was a ring at a hardcoded −0.2 elevation, swept by one angle. That meant
`ShoulderSwing`, `ShoulderOut` and `Elbow` **did nothing at all** on a gripping arm. Three
of the four arm controls were inert and the panel gave no hint.

From the outside this reads as "I cannot get this arm where I want it", not "these sliders
are disconnected". Fixed by making the pole the elbow direction the shoulder drivers asked
for — the FK solve was already computing it and throwing it away.

`Elbow` is still inert while gripping, and that one is correct: with both ends fixed the
elbow angle follows from the distance. Worth a comment saying so, or it looks like the same
bug again.

## 6. Missing geometry impersonates broken drivers

Three times a driver looked dead when the problem was that nothing on screen could show it:

- `headYaw` / `headPitch` — the head was a symmetric box. Added a visor.
- the elbow drivers — the arm chain just ended, no hand mesh. Added mitts.
- mitt tinting would have shown both hands changing together — `Mesh.clone()` shares the
  material, so the back mitt had no material of its own.

Before debugging a driver, check that the thing it moves is actually drawn and actually
distinguishable.

## 7. Measure transforms, never echo drivers

The old tweak axis was `(grab.z, 0, −grab.x)`, which degenerates to `(0,0,−1)` at
mid-board — a pure roll. Nose elevation was **0° at every tweak depth** while the HUD
proudly reported 85°, because the HUD was printing the driver back at itself.

Every number in `pose-shot.html` is now read off an actual world transform. If a readout
can be satisfied without the pose changing, it is not a readout.

## 8. Symmetric test values can hide a real signal

After making the shoulder drivers live, I swept `frontShoulderSwing` at ±1.2, saw two
identical renders, and concluded the fix had not worked.

The pole's component perpendicular to shoulder→hand goes as `cos(swing)`, which is even.
±1.2 produces the *same pole*. The test was symmetric about the one axis that mattered.

Sweep asymmetric values, and prefer a number to a picture — eyeballing two 3D renders could
not distinguish a static elbow from one moving 12 cm. The rig now exposes solved elbow
positions for exactly this reason.

## 9. The authored pose is the record; the reference doc is a hypothesis

`grabs.md` was written first and has been wrong three times:

- "a method and a melon are the same grab, differing only in body pose" — the authored
  method sits at `t = 0.83`, melon at `0.50`. A third of a board apart.
- "a tailgrab's spine extends" — the authored tailgrab has `spineBend` and `spineTwist`
  both exactly 0. The only anchor with no twist at all.
- predicted `japan` at `t = 0.65`; authored at `0.55`.

When a pose off the sliders disagrees with the doc, the pose wins and the doc gets a note.
Do not "correct" a pose to match prose.

## 10. Sweeping one slider tells you what that slider does, not which slider is wrong

Three poses were over reach 1.0 and a `hipY` sweep gave a clean answer for each: 5–7 cm
more hip drop closes it. That was right for indy and mute.

For japan it was the wrong lever entirely. `spineTwist` was at −1.02, winding the shoulders
*away* from the grabbing hand; flipping it to +0.47 closed the reach with no extra crouch.
The `hipY` recommendation would have got there by brute-force crouching into a pose that
was fighting itself.

A single-variable sweep is a good instrument aimed at the wrong question. Ask what is
*causing* the distance before asking which slider shortens it.

## 11. Acceptance criteria drift out of sync with the spec

`npm run gate` was failing, and most of the failures were the gate being wrong:

- it asserted knees diverge by ≤10°, while the authored method runs **113/55** — asymmetric
  legs were an explicit later requirement, so the test forbade what had been asked for.
- it swept synthetic depth overrides onto `method`, which made sense when method was a
  reconstruction and measures a pose nobody authored now that it is a real anchor.

Criteria written before the thing exists describe what you *expected*, and need re-cutting
once real poses land — but re-cutting them is an owner decision, not a tidy-up. Leaving it
red and saying why is better than quietly relaxing it until it passes.

**Now re-cut.** Both of those assertions are gone rather than relaxed, and what replaced them
is the set of sweeps that had actually been catching defects while living in a scratch
directory outside the repo: endpoint reach per *grabbing* hand, and reach across the whole
transition, sampled densely through the grip-commit window at four decimals. Verified by
reintroducing the defect — `gripDelay` at 0 fails all eight and exits 1.

Aspect is printed but deliberately **not** asserted. `japan` at 0.59 and `method` at 0.83 are
under the 1.0–1.3 band, the cause is known (§12), but that band was written before any pose
existed and nobody has confirmed it. Hard-failing on an unconfirmed criterion just teaches
everyone to ignore the gate.

## 12. `boardVsTorso` is about the *sign* of the lean, not the board angle

The current open problem, recorded so the next pass does not start from scratch.

`japan` and `method` both read as folded — aspect 0.59 and 0.83 against a 1.0–1.3 want. The
instinct is that the board is over-pitched, but japan's board elevation is 52°, squarely
inside the 40–55 band, and the best it has ever measured.

The actual issue: torso is 24° off vertical, board is 38° off vertical, **the same way**, so
they are only 14° apart and the rider is stacked along the board. The three bands are only
mutually satisfiable if the torso leans *opposite* to the board — 35–50° of board plus
40–50° of torso on the other side sums to the 75–90° the spec asks for. Right now they
cancel instead of adding.

So the lever is whichever of `spineSide`, `hipRoll` or `pelvisPitch` tips the torso back the
other way, not `boardPitch`. Expect aspect and `boardVsTorso` to move together when it is
found.

---

## Where the ten anchors stand

Measured at `47968bb` by `npm run gate`. Reach is the *grabbing* hand. "path" is the worst
reach anywhere in the crouch → grab transition, which is always slightly above the held
pose — endpoint validity alone was never sufficient.

| anchor | grab | reach | path | aspect | knees f/b |
|---|---|---|---|---|---|
| neutral | — | — | — | 0.93 | 54/54 |
| crouch | — | — | — | 1.17 | 113/113 |
| indy | back, toe, t 0.38 | 0.9755 | 0.9858 | 1.34 | 116/151 |
| mute | front, toe, t 0.54 | 0.9865 | 0.9899 | 1.20 | 143/148 |
| melon | front, heel, t 0.55 | 0.9701 | 0.9727 | 1.15 | 133/152 |
| method | front, heel, t 0.83 | 0.9873 | 0.9895 | **0.83** | 113/55 |
| stalefish | back, heel, t 0.39 | 0.9762 | 0.9789 | 1.19 | 124/154 |
| japan | front, toe, t 0.55 | 0.9388 | 0.9711 | **0.59** | 140/114 |
| nosegrab | front, nose tip | 0.9812 | 0.9820 | 0.96 | 153/120 |
| tailgrab | back, tail tip | 0.9339 | 0.9644 | 1.21 | 131/151 |

All eight grabs are valid held *and* throughout their transition. Every one is in the amber
band (§1) — the set sits at full extension, so none of them has arm-routing room to spare.

Open, in rough priority order:

1. `japan` and `method` silhouettes — see §12.
2. ~~Re-cut the gate~~ — done, see §11. It now checks endpoint and whole-path reach and
   passes; aspect is printed but not asserted.
3. Nothing has arm-routing margin. The eight run 0.934–0.987 reach, all amber. It only bites
   when a pose needs its arm routed round a leg, which so far is `japan` alone.
4. COM drift across a tweak sweep is ~9 cm against a 5 cm limit. Needs hips solved *from*
   board displacement rather than independently.
5. Grabs are not wired to the pad. `scene.ts` has no grab references, nothing reads
   `input.rx`/`input.ry`, there is no `grab` param group, and `tweakOffset` is absent from
   `RiderState` though the landing test in design §6 needs it. This is gameplay code against
   the rig, so it waits on the milestone 4 gate being called.
