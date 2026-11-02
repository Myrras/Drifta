# Drifta spec v1

Top-down 2D drift game, Tony Hawk-style combos, point-to-point maps.

## Game

- Camera: north-up, follows car, look-ahead in velocity direction, zooms out with speed.
- Car: red roadster (no brand names/logos). Arcade bicycle model, RWD, drift assist, slightly overpowered.
- Map 1: original 3-floor parking garage. Start on roof, finish at ground-floor exit gate. Pillar grid, painted bays, parked cars, ramps on alternating sides. Par 60 s.
- Floors: only current floor drawn. Ramp zone = fade to next floor.
- Drift: slip angle > 15° and speed > 30 km/h.
- Combo: drift points slipDeg × speedKmh × dt × scale. Grace 1.5 s between drifts (paused during floor fade). +1 multiplier per trick, no cap. Banks (points × multiplier) when grace runs out. Lost on wall hit.
- Tricks: Close Call +250, Switchback +500, Long Drift +300 per 2 s, 360 +1000, Ramp Drift +750.
- Wall hit: bounce, big speed loss, combo lost. No damage. Static obstacles only.
- Score: banked combos + 100 per second under par. Best score in localStorage.
- Flow: title → 3-2-1 → run → results (breakdown, NEW BEST). Esc/Start = pause, auto-pause on blur, R = restart.
- HUD: timer + par, floor, combo string + multiplier + combo points, total score, speedometer. No minimap.
- Look: flat vector, dark concrete, painted bays, fluorescent light patches, persistent tire marks per floor, smoke.
- Audio: Web Audio synth only: engine (pitch = rpm), tire squeal, hit, bank ding. No music.
- Input: keyboard (WASD/arrows, Space handbrake, R restart, Esc pause, Enter confirm) + gamepad standard mapping (left stick steer, RT throttle, LT brake/reverse, A handbrake, Start pause/confirm).

## Tech

- Vite + TypeScript strict, npm, no runtime deps, plain Canvas 2D.
- Fixed timestep 60 Hz physics, rAF render, devicePixelRatio + resize.
- Units: meters, seconds, radians. Renderer converts to pixels.
- scoring, car, collision are pure (no DOM) and covered by Vitest.
- Checks: typecheck, format:check, test, build.
- Repo Myrras/Drifta (public). GitHub Actions on push to main: typecheck → test → build → deploy-pages. Vite base './'.
