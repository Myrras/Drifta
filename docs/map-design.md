# Map design principles

Top-down drift maps. Each principle ends with how Drifta applies it.

1. **Flow and rhythm.** Alternate tension (tight, dense) and release (open, fast). Drifta: B1 technical pillars and a donut bay, B2 perimeter sweeper lap.
2. **Linked corners.** Opposite corners close together enable switchbacks. Drifta: staggered parked-car rows and pillar chicanes, gap sized so one transition fits.
3. **Corner radius variety.** Mix wide sweepers, medium and tight turns so one input never wins. Drifta: wide S-curves vs pillar forest; never repeat one radius twice in a row.
4. **Entry length.** A drift needs an approach to build speed and angle, about 2-3 car lengths before a tight turn. Drifta: straights before corners and helixes; arrows mark turns.
5. **Clipping points and close-call objects.** Put solid objects on the inside of corners so a tight line scores. Drifta: parked cars and pillars at apexes trigger Close Call; clipping zones are in docs/ideas.md.
6. **Risk-reward lines.** Safe wide line vs short line near a wall that pays more. Drifta: tight line past pillars gives Close Call and speed; a wall hit loses the combo.
7. **Track width.** About 4-6 car widths in corners so the slide fits; narrower only for deliberate precision sections. Drifta: B2 sweepers wide enough for a 360, B1 tighter.
8. **Readability.** Outline edges with parked cars, cones, barriers; contrast road vs obstacles; keep drivable space clearly lighter. Drifta: painted bays and arrows, light pools on dark concrete.
9. **Sightlines vs look-ahead.** The camera looks ahead along velocity; the next corner must show before commit. Drifta: no blind turns beyond look-ahead distance; zoom out with speed.
10. **Landmarks.** Distinct features help orientation. Drifta: helix cores, exit gate, recognizable car silhouettes; no minimap.
11. **Run-off and forgiving exits.** A missed corner costs the combo, not the run. Drifta: bounce on walls, no damage, open space after hard sections.
12. **No dead ends.** Every area leads forward or loops; no forced reverse. Drifta: no 180 degree turns on floors; the only half turn is the helix.
13. **Free-roam with suggested line.** Open areas show a faint line players may ignore for a higher score. Drifta: test pad is free-roam; suggested-line decals are in docs/ideas.md.
14. **Pacing and par time.** Par is a clean run plus about 15%; keep runs near a minute so retries are cheap. Drifta: par 40 s on B2 MEET, 77 s on TOKYO NIGHTS (two routes, A over the scramble and B along the canal, then a helix up to the elevated expressway: sweepers and S-bends, no right angles, one long banked curve), +100 per second under par.

## Sources

- Absolute Drift (objectives, clip points): https://fingerguns.net/reviews/2020/12/03/absolute-drift-zen-edition-review-switch-slide-in-style/
- Forza Horizon Drift Attack clipping zones: https://boxthislap.org/forza-horizon-6-drift-attack-guide/
- Numeric guidance (widths, entry lengths, par margin) is a starting heuristic from genre experience, not from a single source; tune by playtest.
