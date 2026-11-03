# Drifta

Top-down 2D drift game with Tony Hawk-style combos. Runs in the browser. Vite + TypeScript.

**[Play now: myrras.github.io/Drifta](https://myrras.github.io/Drifta/)**

![Tokyo Nights](docs/screenshots/tokyo.png)

## Features

- **Combos:** chain drifts, build a multiplier, bank it before the grace timer runs out. A wall hit loses the combo.
- **Tricks:** Close Call, Switchback, Long Drift, 360, Ramp Drift, near-miss chains.
- **Scoring:** banked combos plus a bonus per second under par. Best scores and top-3 positions per map.
- **Cars and tuning:** 13 cars (MX-5, Supra, RX-7, Skyline, Silvia, AE86 and more). Street or performance tune.
- **Garage looks:** paint, underglow, smoke colours, spoilers, carbon hood, window tint. Cosmetic only, unlocked by finishing maps and daily clears.
- **Daily challenge:** a date-seeded run, same for everyone. LEGEND days add a special car and skin.
- **Ghosts:** race your best run on each map.
- **Online 1v1:** WebRTC with invite/reply codes, no server. Rival ghosts, shared results, rematch.
- **Drift clips:** save your top-3 drifts from the results screen as `.webm` (480p to 1080p).
- **Photo mode:** freeze the car, then pan, zoom and rotate the camera.
- **Music:** procedural PHONK track, or MY MUSIC to import your own MP3s.
- **Live maps:** traffic with lights, pedestrians, police and boom cars playing loud bass.
- **Menu themes:** ARCADE or VHS.
- **Gamepad:** full menu and driving support, PS or Xbox glyphs follow the last-used device.

## Maps

<table>
  <tr>
    <td width="50%">
      <img src="docs/screenshots/tokyo.png" alt="Tokyo Nights"><br>
      <b>TOKYO NIGHTS</b><br>
      Neon city with two routes (over the Shibuya-style scramble, or along the canal) up to an elevated bendy expressway. Par 77 s.
    </td>
    <td width="50%">
      <img src="docs/screenshots/docks.png" alt="Wangan Docks"><br>
      <b>WANGAN DOCKS</b><br>
      Night port with a harbour and ship, car rows and painted bays.
    </td>
  </tr>
  <tr>
    <td>
      <img src="docs/screenshots/drivethru.png" alt="Midnight Drive-Thru"><br>
      <b>MIDNIGHT DRIVE-THRU</b><br>
      MOONBURGER live car meet: hundreds of parked cars, a show row and a rounded drive-thru lane.
    </td>
    <td>
      <img src="docs/screenshots/garage-map.png" alt="B2 Meet"><br>
      <b>B2 MEET</b><br>
      Two-floor underground meet. B1 is technical with pillars and a donut bay, a helix drops to the B2 sweeper lap. Par 40 s.
    </td>
  </tr>
</table>

## Screens

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/title.png" alt="Title menu"><br>Title</td>
    <td width="50%"><img src="docs/screenshots/garage.png" alt="Car garage"><br>Garage</td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/results.png" alt="Results"><br>Results</td>
    <td><img src="docs/screenshots/lobby.png" alt="Multiplayer lobby"><br>Multiplayer lobby</td>
  </tr>
</table>

## Controls

| Action                  | Keyboard      | Gamepad |
| ----------------------- | ------------- | ------- |
| Steer / throttle, brake | WASD / arrows | Stick   |
| Handbrake               | Space         | A       |
| Clutch                  | Shift         | LB      |
| Restart                 | R             |         |
| Pause                   | Esc           | Start   |
| Confirm / back          | Enter / Esc   | A / B   |
| Skip song in a run      | N             | RB      |
| Settings tab left/right | Q / E         | LB / RB |
| Garage: tune            | T             |         |
| Garage: rev             | Hold R        | RT      |
| Results: pick a drift   | Up / Down     |         |
| Results: save clip      | S             | X       |
| Photo mode              | P             | R3      |

## Multiplayer

1. Both players use the same version (refresh if the lobby reports a mismatch).
2. Open the multiplayer entry on the title menu.
3. Host: create an invite code and send it to your friend.
4. Guest: paste the invite, send back the reply code.
5. Host: paste the reply. The link connects directly (WebRTC).
6. Pick a map and car (switch cars via the garage), then race. Rematch from the results.

Set your username in SETTINGS or on the title menu.

## Settings

Tabs AUDIO / VIDEO / GAME (Q/E, gamepad LB/RB).

- **MUSIC:** select the track. MY MUSIC imports your own MP3s (stored in the browser, 500 MB cap, shuffled).
- **MENU THEME:** ARCADE or VHS.
- **CLIP QUALITY:** OFF / LOW (480p24) / MEDIUM (720p30) / HIGH (1080p60).
- Volumes (master, music, sfx, engine), screen shake, ghost on/off, username.

## Development

```
npm install            # setup
npm run dev            # dev server
npm test               # tests
npm run typecheck      # type check
npm run build          # production build
npm run render:engine  # engine sound renders
```

## Docs

- [docs/spec.md](docs/spec.md): game spec
- [docs/ideas.md](docs/ideas.md): feature backlog
- [docs/map-design.md](docs/map-design.md): map design principles

## Credits

Audio sources and licenses (all CC0): [CREDITS.md](CREDITS.md).
