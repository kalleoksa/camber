# Feedback from test riders

Testers play the Vercel build and send back one file. No install, no accounts, no backend.

## How it works

- Every run records from its reset (Y on the pad, R on the keyboard, or reset/record in the panel). Nothing
  needs arming in advance.
- **Mark** a moment while riding: View/Back on the pad, or `M` on the keyboard. On a
  standard-layout pad the D-pad marks with a tag: up `good`, down `bad`, left `bug`,
  right `look`. Marks never enter the input snapshot, so they can't touch the sim.
- Marks appear in the panel's **feedback** folder. Each has a tag, a text field and
  **watch it again**, which replays the run from two seconds before the mark. Marks made
  while watching go on that run.
- Runs with marks are kept across resets. **download feedback** saves
  `camber-feedback-<name>-<time>.json.gz`: every marked run as a full take (inputs,
  params, park) with its notes, the tester's name, and the commit it was built from.

## Reading it

Put files in `feedback/incoming/` and run `npm run notes`, or pass files as arguments.
Each run is re-simulated and checked against its own hashes. A file from another build
says so; check out the commit it names to replay it exactly. Around every note it prints
mode changes and landings (with impact), then a timeline of speed, mode and stick.

## Brief to send testers

> Play at <preview link>. A gamepad is best (Xbox or PlayStation, Chrome).
> Left stick edges and spins, hold and release RT to pop, right stick grabs, Y resets.
> Whenever something feels good, wrong or broken, press **View/Back** (or **M**) right
> then. On the D-pad: up = felt good, down = felt wrong, left = bug, right = looks off.
> Afterwards, open **feedback** in the panel on the right, write a few words under each
> mark (use **watch it again** if you need a reminder), put your name in, and press
> **download feedback**. Send me the file.

## Later, if sending files gets tedious

A single Vercel function writing to Vercel Blob would make it one click. That is a
backend and a dependency, both against the locked stack, so it needs a decision first.
