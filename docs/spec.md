# Drifta spec v1

Top-down 2D drift game, Tony Hawk-style combos, point-to-point maps.

## Game

- Camera: north-up, follows car, look-ahead in velocity direction, zooms out with speed.
- Car: red roadster (no brand names/logos). Arcade bicycle model, RWD, drift assist, slightly overpowered.
- Drift arcs: the path curves toward the nose; steering keeps authority in a drift; throttle adds angle, lift straightens; handbrake only initiates.
- Map 1: B2 MEET, original 2-floor underground drift meet with drift-meet decor, a different layout per floor. B1: technical, pillars and an open donut bay. B2: perimeter sweeper lap to the exit gate. No 180° turns on floors; the only half turn is the helix. Par 40 s.
- Map TOKYO NIGHTS: one-floor neon district. Grid streets with traffic lights, live traffic (a hit breaks the combo), pedestrians, a scramble crossing, and a one-way expressway loop. Par 66 s.
- The floors are joined by a helix: a half circle around a round core in alternating corners. Car position is continuous (shared footprint), floors crossfade while in the helix with a slight zoom dip; floor switches halfway. Scoring keeps running; Ramp Drift (+750) when drifting through ≥ 60% of the half circle.
- Drift: slip angle > 15° and speed > 30 km/h.
- Combo: drift points slipDeg × speedKmh × dt × scale. Grace 1.5 s between drifts (paused during floor fade). +1 multiplier per trick, no cap. Banks (points × multiplier) when grace runs out. Lost on wall hit.
- Tricks: Close Call +250, Switchback +500, Long Drift +300 per 2 s, 360 +1000, Ramp Drift +750.
- Wall hit: bounce, big speed loss, combo lost. No damage. Static obstacles only.
- Score: banked combos + 100 per second under par. Best score in localStorage.
- Flow: title → 3-2-1 → run → results (breakdown, NEW BEST, top 3 banked combos with a saveable video clip each: ~1-2 s lead-in, canvas + HUD + game audio). Esc/Start = pause, auto-pause on blur, R = restart.
- HUD: timer + par, floor, combo string + multiplier + combo points, total score, RPM tach (replaced the speedo). No minimap.
- B2 MEET parked cars are 90s JDM models (Civic EG, Supra MK4, RX-7 FD, Skyline R32, Silvia S13, 180SX, AE86, NSX, Evo IV, Impreza WRX), recognizable top-down silhouettes, no badges/logos.
- Lighting: dark garage, soft ceiling light pools (no fixtures drawn), player car pop-up headlight cones + tail/brake/reverse lights, ~1 in 5 parked cars with headlights on, some with blinking hazards.
- Floor arrows: large painted garage arrows only before turns and at helix entries.
- Engine: physically modelled 4-cylinder synth (firing pulses + exhaust resonance).
- Look: flat vector, dark concrete, painted bays, fluorescent light patches, persistent tire marks per floor, smoke.
- Audio: CC0 samples (engine loop pitched by rpm, tire squeal loop, hit, bank ding) in public/sounds, sources in CREDITS.md.
- Input: keyboard (WASD/arrows, Space handbrake, R restart, Esc pause, Enter confirm) + gamepad standard mapping (left stick steer, RT throttle, LT brake/reverse, A handbrake, Start pause/confirm), N / pad RB skip song (in a run), Q/E / pad LB/RB switch settings tabs.

## Tech

- Vite + TypeScript strict, npm, no runtime deps, plain Canvas 2D.
- Fixed timestep 60 Hz physics, rAF render, devicePixelRatio + resize.
- Units: meters, seconds, radians. Renderer converts to pixels.
- scoring, car, collision are pure (no DOM) and covered by Vitest.
- Checks: typecheck, format:check, test, build.
- Repo Myrras/Drifta (public). GitHub Actions on push to main: typecheck → test → build → deploy-pages. Vite base './'.

## v0.4

- Main menu: Play / Garage / Settings.
- Garage: car select (11 cars), paint colour, car stats affect physics.
- Settings: volumes, camera shake, reset bests; persisted.
- Procedural eurobeat-style music that reacts to the combo.
- Maps: JAPAN GARAGE (outlined by parked cars), WANGAN DOCKS, TEST PAD.

## v0.7 and v0.8

- Cars: RX-8 (Renesis NA rotary), Celica GT-Four ST205 (RWD CONVERSION tag).
- Maps: JAPAN GARAGE replaced by B2 MEET; new TOKYO NIGHTS.
- Settings tabs AUDIO/VIDEO/GAME (Q/E or LB/RB); MENU THEME ARCADE or VHS.
- On-screen hints follow the last-used device, PS or Xbox glyphs.
- RPM tach replaces the speedo; live attract-mode scene behind the menu.
- MY MUSIC: import own MP3s (browser storage, 500 MB cap, shuffled); N / RB skips a song in a run.
- Redesigned countdown and combo HUD juice.
- World juice: body roll, smoke, sparks, speed feel.
- Dark lighting with readable obstacle rims.
- Auto-recover when stuck (2.5 s).
- Gamepad B = back.
