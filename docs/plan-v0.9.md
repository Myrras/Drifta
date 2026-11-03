# Drifta v0.9 plan (living doc)

Repo: `C:\Users\Robbi\Projects\Drifta`. Source of truth for the v0.9 work. Update the status table as slices land. Another session can resume from here.

Base commit: `8dae1da` (main). Run mode: **Full go** (orchestrator spawns slices in worktrees, merges, reviews, deploys).
Deploy rule: merge to main + push after verification. **Exception:** the PHONK track (slice 1) waits until the user has listened to it.

## Decisions (agreed with the user, 2026-11-03)

Music
- The YouTube phonk mix is copyrighted: not bundled, no samples taken. User can play it via MY MUSIC (local import).
- Write one original procedural PHONK track (Memphis cowbell lead, distorted 808 with slides, trap hats, dark minor, ~130 BPM).
- Remove music tracks TOKYO and EUROBEAT (`src/music.ts` TRACKS). Track list = PHONK + MY MUSIC. Saved settings pointing at old tracks migrate to PHONK.

Audio
- Countdown: synthesized beeps on the sfx bus. 3-2-1 short low beep, GO higher and longer. Same style as menu blips (`audio.ts` UiSound).

Results / finish screen
- Bug: controller glyphs missing. `hud.ts:778` hardcodes `↑/↓ pick · S / X save clip`; SAVE is plain text. Route through `hintLine`/glyph (`ui/prompts.ts`).
- Full-screen redesign: big total, position badge (1ST/2ND/3RD) + next target, stats as small chips, 3 snapshot cards for top drifts (score + combo name under each), bottom hint bar with device glyphs. Save clip still works on the selected card.
- Snapshot = still frame from the middle (by time) of each top drift.

Maps
- Wangan Docks: same layout, visual restyle to night port (colorful container stacks, gantry cranes with warning lights, sodium orange light pools, wet asphalt reflections, docked ship, harbor water at edges).
- Tokyo Nights: keep the look. Replace the square block grid with flowing roads (sweepers, S-bends, a few hairpins). Two routes to the highway with similar time:
  - Route A over Shibuya-style scramble crossing (diagonal zebra stripes, giant screens, neon). Slightly longer, crossing is a bonus zone (trick `SCRAMBLE`). Pedestrians decorative only.
  - Route B our own design: along a canal under elevated train tracks, lantern-lit sweepers, one tight chicane under a station.
  - Side streets closed with barriers, cones and road-closure signs (visual dead ends).
  - Parked police cars by the highway on-ramp: light bar flashes, drifting close past them scores `COP SHOW`. No chases.
- New map **MIDNIGHT DRIVE-THRU**: invented brand **MOONBURGER** (glowing moon logo), night car meet in a parking lot, coffee truck, meet cars with hoods up, drive-thru lane looping the restaurant = bonus zone (trick `DRIVE-THRU`) when drifted fully. Never real brand names.
- Parked cars: random parked cars get no bay outline. Painted bays only in real lots, cars sit exactly inside them (B2 MEET, Docks, Drive-thru). Outlines come from `Floor.bays` (`render.ts:818`).
- TEST PAD: no positions, unlocks or dailies.

Progression
- First launch: one-time picker, choose one of Civic / RX-8 / 180SX. All other cars locked.
- Per racing map positions 3RD / 2ND / 1ST (replace BRONZE/SILVER/GOLD). Need score >= X AND time <= Y:
  - score: existing `medals` [3rd, 2nd, 1st]; time: `parTime` x1.3 (3rd), x1.15 (2nd), x1.0 (1st).
- 1st on a map = one car pick (once per map). 3rd and 2nd each unlock one paint for that map (8 paints total).
- Car pick: chooser on results showing locked cars only; LATER keeps the pick for the garage.
- Cheat: controller only, `up up down down left right left right A` on the main menu. Unlocks all cars + paints + cosmetics for the **session only** (not saved). Toast + sound.

Fun additions
- A Ghost: best run per map stored, replayed as translucent car with the car + look used on that run. Settings toggle, default on. Replaced on new best.
- B Daily challenge: date-seeded map (same for everyone), target = 2nd-place score x1.1. Main menu entry, streak counter, missing a day resets. Each clear drops one random unowned cosmetic; every 3rd clear also gives a car pick (covers the other 6 cars).
- B+ LEGEND challenge: ~1 in 10 days replaces the daily (date-seeded). Target = 1st score x1.5 with zero wall hits, fixed car. Reward = skin. First legend: Tokyo, RX-7, skin FORTUNE ORANGE. Missed skins return when that legend comes round again.
- C Photo mode: pause menu entry + shortcut P (kb) / R3 (pad). Free camera (pan, zoom, rotate), HUD hidden, A/Enter saves PNG.
- D Near-miss chain: consecutive CLOSE CALLs in one drift add +0.1, +0.2, +0.3... to the multiplier. Any contact resets. HUD shows `NEAR MISS xN`.
- E Garage customisation, cosmetic only (no performance upgrades): paint, skin, underglow color, tyre smoke color, spoiler (none / ducktail / GT wing), carbon hood, window tint. No rims/exhaust (not visible top-down).
- Skin FORTUNE ORANGE: orange/black widebody RX-7 FD look. Never use "Han", "Tokyo Drift", "VeilSide" or film names.

## Shared contracts

types.ts patch (apply verbatim in every slice that needs it, so parallel merges are identical):
1. `Solid`, after the `lights?` field:
   ```ts
     /** parked police car: light bar flashes, close drifts score COP SHOW */
     police?: boolean;
   ```
2. `Floor`, after the `clipZones?` field:
   ```ts
     /** bonus zones: drift through every rect sharing an id within one combo to fire its trick once */
     bonusZones?: BonusZone[];
   ```
3. Right after the `Floor` interface (before `export interface Circle`):
   ```ts
   export interface BonusZone extends Rect {
     id: string;
     trick: Trick;
   }
   ```
4. `Trick` becomes (exactly these two lines):
   ```ts
   export type Trick =
     'DRIFT' | 'CLOSE CALL' | 'SWITCHBACK' | 'LONG DRIFT' | '360' | 'RAMP DRIFT' | 'CLIP' | 'NEAR MISS' | 'SCRAMBLE' | 'DRIVE-THRU' | 'COP SHOW';
   ```

Cosmetic ids (strings, shared by progress / cosmetics / daily):
- Paints per map `[3rd, 2nd]`: B2 MEET `['concrete-grey','b2-violet']`, WANGAN DOCKS `['harbor-teal','crane-yellow']`, TOKYO NIGHTS `['neon-pink','midnight-blue']`, MIDNIGHT DRIVE-THRU `['moon-gold','ketchup-red']`.
- Cosmetics: `underglow-pink`, `underglow-cyan`, `underglow-green`, `underglow-purple`, `smoke-pink`, `smoke-cyan`, `smoke-yellow`, `smoke-purple`, `spoiler-ducktail`, `spoiler-gt`, `hood-carbon`, `tint-dark`, `tint-limo`.
- Skins: `fortune-orange` (rx7 only).
- Look (per car, stored opaque in progress): `{ paint?, skin?, underglow?, smoke?, spoiler?: 'ducktail'|'gt', hood?: boolean, tint? }` (values are the ids above).

progress.ts API (slice 4, used by wave 2):
- `positionFor(map, score, time): 1|2|3|null`
- `loadProgress()`, `saveProgress(p)` (localStorage `drifta.progress`)
- `awardFinish(p, map, score, time) -> { position, newPaints: string[], carPick: boolean }`
- `isCarUnlocked(p, car, cheat)`, `ownsCosmetic(p, id, cheat)`, `spendCarPick(p, car)`, `recordDailyClear(p, date)`.

Snapshot (slice 6): each top-drift take gets `still?: HTMLCanvasElement` from the middle of the drift.

Hot files edited by several slices with small hunks: `game.ts`, `render.ts`, `hud.ts`, `decor.ts`, `main.ts`, `settings.ts`. The merge step resolves conflicts.

## Slices

| # | Task | Files owned | Model/effort | Wave | Depends | Branch | Status |
|---|------|-------------|--------------|------|---------|--------|--------|
| 1 | PHONK track, remove TOKYO/EUROBEAT, settings migration | music.ts, settings.ts | inherit/high | 1 | - | worktree-agent-a6195cbc1d9544a9c @065d3f8 | done, verified, user approved the sound (2026-11-03) |
| 2 | Countdown beeps (audio: user listens before deploy) | audio.ts, game.ts countdown | sonnet/medium | 1 | - | worktree-agent-aa244064e894dbf1f @cb27511 | done, verified |
| 3 | Bonus zones + COP SHOW + NEAR MISS chain (scoring + game wiring) | types.ts, scoring.ts | sonnet/medium | 1 | - | worktree-agent-a4929169c2bc51e75 @d5dad49 | done, verified (adds ScoreFrame.bonusAll) |
| 4 | Progress store + positions | progress.ts (new) | sonnet/medium | 1 | - | worktree-agent-ad4b4631ff8d00a1d @768eda1 | done, verified |
| 5 | Cosmetics catalogue + car drawing (paints, skin, spoiler, hood, tint, underglow, smoke) | cosmetics.ts (new), sprites.ts | inherit/high | 1 | - | worktree-agent-ae7374bcbd161ad5d @5086b6c | done, verified (drawCar(ctx,model,color,look?); smokeColor) |
| 6 | Mid-drift snapshot per top drift | clips.ts | sonnet/medium | 1 | - | worktree-agent-a65082c962b6cb9a5 @6d84bfa | done, verified (`clips?.still?.(id)`) |
| 7 | Wangan Docks restyle + bays fix | maps/docks.ts | inherit/high | 1 | contract | worktree-agent-a6e29ebe357b6d8b2 @8721c2c | done (added bays under parked rows: removed again in M2) |
| 8 | Tokyo roads, 2 routes, closures, Shibuya, police | maps/tokyo.ts | inherit/xhigh | 1 | contract | worktree-agent-a13f7f6016b14dab8 @ae17f4d | done, verified (A 621 m / B 590 m city part, par 82, medals 7500/17000/30000) |
| 9 | MIDNIGHT DRIVE-THRU map | maps/drivethru.ts (new), main.ts | inherit/high | 1 | contract | worktree-agent-a69bb9e040587dddd @9d33df0 | done, verified (137 meet cars, par 46, medals 4500/9500/17000) |
| 10 | B2 MEET bays fix | maps/garage.ts | sonnet/medium | 1 | - | worktree-agent-a9d537322549369de @2fbc333 | done, verified |
| 11 | Ghost per map + settings toggle | ghost.ts (new) | sonnet/medium | 1 | - | worktree-agent-aff98747bf2d5c200 @f763af3 | done, verified (look stores only {color}; slice 14 must store full Look + draw with it) |
| 12 | Photo mode + P/R3 shortcut | photo.ts (new), input.ts | sonnet/medium | 1 | - | worktree-agent-a2ab67825bb5f4dbb @c229a29 | done, verified (pause has hint line, not a menu row) |
| 13 | Finish screen redesign + glyph fix + awardFinish + car-pick chooser (results-phase input in game.ts) | hud.ts, ui/prompts.ts | inherit/high | 2 | 4, 6 | worktree-agent-ab0f9b7a288d6950c @52afe65 (includes S4,S6) | done, verified |
| 14 | Progression flow: first-launch pick, locks, car-pick in garage, Konami cheat (session flag) | game.ts title/garage, input cheat buffer | inherit/high | 2 | 4, 5, 12 | worktree-agent-a88386d45574f8df2 @2e0d003 (includes S4,S5,S12) | done, verified (createGame 7th param prog; s.cheat) |
| 15 | Garage customisation menu + in-race look (render, smoke, ghost full look) | ui/garage.ts (new), render.ts player hunk, particles.ts | sonnet/high | 2 | 4, 5, 11 | worktree-agent-a14ffcf531aebafbb @5c747e3 (includes S4,S5,S11) | done, verified. Open: underglow dims under darkness pass (needs bright pass); `let cheat` in game.ts for S14 to set; conflicts expected with S14 around garage state/view() |
| 16 | Daily + LEGEND challenge | daily.ts (new) | sonnet/medium | 2 | 4, 5, 7-9 | | planned |
| M1 | Merge S1,S2,S3,S10,S13,S15,S14 into `v0.9` (from 8dae1da); one Progress instance, one cheat flag | - | sonnet/high | 3 | non-map slices | v0.9 @c085dea (worktree .claude/worktrees/agent-ab1f63fe91c1cb248) | done, verified 455 tests |
| 16b | S16 runs on branch s16-daily (from v0.9 + S9), also replaces title BRONZE/SILVER/GOLD with positions | | sonnet/high | 3 | M1 | s16-daily @e11c61c | done, verified; merging into v0.9 (M3a). Legend clear also counts toward streak; legend run can overwrite best/ghost |
| FX1 | Fix-ups 1-4: chooser sprite, paint names, underglow light pass, cheat+chooser | | sonnet/medium | 3 | M1 | fx-fixups @f4de5ff | done, verified (minor: results hint says "choose car" while cheating) |
| M2 | Merge fx-fixups, S9, S7 into v0.9 + ROOT CAUSE fix of parked-car outline: `buildRim` (render.ts ~575) strokes every solid incl. parked cars → skip kind 'car'; drop docks bays | - | sonnet/medium | 3 | 7, 9, FX1 | v0.9 @bb9e09b | done, verified 466 tests (leftover unused rowOf/BAY_PAINT in docks.ts) |
| M3a | Merge s16-daily into v0.9 | - | sonnet/medium | 3 | 16 | v0.9 @ff56698 | done, verified 481 tests + build |
| M3b | Merge S8 Tokyo into v0.9 + COP SHOW reachability (police 5.4 m off route vs 2.5 m threshold) + copy plan to docs | - | sonnet/high | 3 | 8 | v0.9 | running |
| R2 | Review Tokyo merge diff | - | inherit/high | 3 | M3b | | planned |
| D | Merge v0.9 → main, push (deploy) | - | haiku/low | 3 | R2 | main | planned |
| R1 | Review 8dae1da..v0.9 (all but Tokyo) | - | inherit/high | 3 | M3a | | done: 8 findings (float multiplier, near-miss cap 10, NEAR MISS grouping, loadProgress throw, stills w/o clip stream, stills while paused, unbounded sprite caches, cheat looks persisted) |
| RF1 | Fix R1 findings on v0.9 | - | sonnet/medium | 3 | R1 | v0.9 @49fceb2 | done, verified 485 tests |
| FX | Integration fix-ups list below + S16 daily/legend on v0.9 | - | - | 3 | M1 | | planned |
| M | Commit this plan to `docs/plan-v0.9.md` on v0.9 | - | haiku/low | 3 | M2 | v0.9 | planned |
| R | Fresh review of combined diff | - | inherit/high | 3 | M | | planned |

## Integration fix-ups (after merge M)
- Pass session `cheat` into results chooser (hud/game hardcode false) and garage (`let cheat` in game.ts).
- Title menu still shows BRONZE/SILVER/GOLD (`MEDAL_NAMES`): show 1ST/2ND/3RD position per map.
- Results car chooser shows names only: show car sprite (export `carImage` from ui/menu.ts) with look.
- Results paint toasts: use cosmetics catalogue names (itemById) instead of id-derived names.
- Underglow dims under the darkness pass: draw a bright glow pass after lighting.
- Ghost look now full (S15); verify ghost draws skin/spoiler.
- Full-floor tarmac decor (Tokyo, Drive-thru) hides render.ts turn arrows and any floor-layer bonus-zone drawing; drive-thru paints its own arrows.

## How to resume
1. `git branch -a` / `git worktree list` to find slice branches; compare with the table.
2. Slices marked running without a branch commit: respawn from this doc.
3. Verify each branch: `npm run typecheck && npm test && npm run build`.
4. Then wave 2, merge, review, deploy (PHONK only after the user listened).

## Log
- 2026-11-03: plan agreed, Full go, wave 1 spawned.
- 2026-11-03: all slices except S8 Tokyo merged into v0.9 (@49fceb2, worktree .claude/worktrees/agent-ab1f63fe91c1cb248), reviewed and fixed. User approved PHONK and playtest build ("Sounds great!", incl. countdown beeps). Remaining: S8 Tokyo → merge into v0.9 → review Tokyo diff → user playtest → merge v0.9 to main + push (deploy) + commit this plan as docs/plan-v0.9.md.
