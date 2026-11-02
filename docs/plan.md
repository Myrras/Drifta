# Drifta build plan

Orchestrated: one subagent per slice, own worktree per change slice, no two slices own the same file.

- Wave 0: W0.1 scaffold · W0.2 GitHub repo + Pages workflow
- Wave 1 (parallel): S1 car.ts · S2 collision.ts · S3 scoring.ts · S4 maps/garage.ts · S5 input.ts · S6 audio.ts · M1 merge
- Wave 2 (parallel): S7 render.ts · S8 hud.ts · S9 game.ts + main.ts · M2 merge
- Wave 3: R1 code review · T1 browser playtest · F1 fixes · D1 deploy
- Wave 4: tuning rounds with the user

Contract: src/types.ts (frozen). Game rules: src/config.ts.
