# Drifta car-sound research (for a parameterised EngineDSP)

Tags: **[S]** = from a cited source (list at bottom). **[E]** = my estimate or design value; no source found. Read [E] as a tuning starting point, not fact. Web sources for engine specs are thin (mostly Wikipedia/forums); web sources for turbo flutter/BOV rates were not found at all, so every number in section 3 is [E].

Baseline in `src/engine.ts` today: inline-4 only (`firePhase += rpm/60*2/sr`, 4 cylinders, `CYL_TIMING`/`CYL_AMP` fixed), `RPM_MIN=900`, `RPM_MAX=7600`, header 0.45 m (refl -0.45, loss 3500 Hz), pipe 1.9 m (refl -0.55, loss 1800 Hz), `C_SOUND=343`, pulse = `t*exp(-t/tau)`, tau 0.25..0.7 ms, pops when rpm>3500 and rpm>3000 per firing. Worklet message is only `{rpm, throttle}`; `audio.ts` has no car awareness. Every profile below needs: a profile message on car change, and turbo/limiter/VTEC state computed inside the DSP from `rpm`+`throttle` (no extra messages needed).

---

## 1. Per-car profile table

### 1a. Engine and ignition

`fires/rev` = firing events per crank rev (4-stroke: cyl/2; 13B: 2). `fireDt` = per-firing timing deviation as fraction of the firing period (sum 0). `amp` = per-firing relative loudness. Order = firing order starting at cyl 1.

| Car (game id)       | Engine                                             | Layout / cyl                | Order                                                                    | Interval                                                              | fires/rev | fireDt                                      | amp (per firing)                                         | Idle rpm                              | Stock redline / limiter                                                                  | Tuned limiter (game)                           |
| ------------------- | -------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------- | --------- | ------------------------------------------- | -------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Civic EG (`civic`)  | B16A (EG6 SiR)                                     | I4                          | 1-3-4-2 [S]                                                              | even 180 deg [S]                                                      | 2         | [.02,-.015,.01,-.015]                       | [1.03,.97,1.01,.99]                                      | 800 [E]                               | 8200 rpm redline and cut, 7400 hp peak [S]                                               | 8400 [E]                                       |
| Supra MK4 (`supra`) | 2JZ-GTE                                            | I6                          | 1-5-3-6-2-4 [S]                                                          | even 120 deg [S]                                                      | 3         | [.01,-.01,.008,-.008,.01,-.01]              | [1.0,.98,1.02,.99,1.01,.97]                              | 750 [E]                               | ~6800-7000 [E]; peak power 5600 [S]                                                      | 7200 [E]                                       |
| RX-7 FD (`rx7`)     | 13B-REW                                            | 2-rotor Wankel              | 2 rotors, 1 pulse per rotor per shaft rev (3 per rotor rev) [S, derived] | even 180 deg of shaft [E]                                             | 2         | [.03,-.03] (+ random partial burn, see 2.5) | [1.1,.9]                                                 | 800 stock; 1000-1400 tuned (lope) [E] | 7000 [E]; early 255 PS @6500, later 280 PS [S]                                           | 7800 [E] (8000 seen on tuned builds [S, weak]) |
| Skyline R32 (`r32`) | RB26DETT                                           | I6                          | 1-5-3-6-2-4 [S]                                                          | even 120 deg [S]                                                      | 3         | [.015,-.01,.01,-.015,.01,-.01]              | [1.0,1.0,.97,1.03,.98,1.02]                              | 850 [E]                               | 8000 [S, single source]; peak 6800 [S]; engine rough 7000-8000 in stock form [S]         | 8200 [E]                                       |
| Silvia S13 (`s13`)  | SR20DET (red-top T25); CA18DET on pre-1991 K's [S] | I4                          | 1-3-4-2 [E, standard I4]                                                 | even 180 deg                                                          | 2         | [.025,-.02,.01,-.015]                       | [1.03,.97,1.01,.99]                                      | 850 [E]                               | 7500 fuel cut, staged cuts starting ~7300 [S forum]; peak 6000 [S] (CA18DET ~7200 [E])   | 7600 [E]                                       |
| 180SX (`180sx`)     | SR20DET (Type R 205 PS @6000 [S])                  | I4                          | 1-3-4-2 [E]                                                              | even 180 deg                                                          | 2         | [-.02,.025,-.015,.01]                       | [.99,1.01,.97,1.03]                                      | 850 [E]                               | as S13                                                                                   | 7600 [E]                                       |
| AE86 (`ae86`)       | 4A-GE 16V                                          | I4                          | 1-3-4-2 [E]                                                              | even 180 deg                                                          | 2         | [.015,-.02,.015,-.01]                       | [1.0,1.0,.98,1.02]                                       | 900 [E]; 1000 w/ cams                 | 7600 max redline 16V [S]; peak 6600-7200 [S]; 20V silver 7800 limit, black 8200-8400 [S] | 8200 (20V/ITB swap) [E, from S limits]         |
| NSX (`nsx`)         | C30A (C32B on 1997+)                               | 90 deg V6, offset crankpins | 1-4-2-5-3-6 (Honda V6 family; not C30A-specific) [S, weak]               | even 120 deg via ~30 deg crankpin offset [S]                          | 3         | [.01,-.01,.01,-.01,.01,-.01]                | bank-alternating [1.03,.97,1.03,.97,1.03,.97]            | 800 [E]                               | 8000 MT / 7500 AT [S]; 280 PS @7300 [S]; C32B 290 bhp @7100 [S], limiter ~7600 [E]       | 8000 [E]                                       |
| Evo IV (`evo4`)     | 4G63T                                              | I4                          | 1-3-4-2 [S]                                                              | even 180 deg                                                          | 2         | [.02,-.02,.015,-.015]                       | [1.04,.96,1.02,.98]                                      | 850 [E]                               | 280 PS (gentleman's agreement cap) [S]; cut ~7500 [E]                                    | 7700 [E]                                       |
| Impreza WRX (`wrx`) | EJ20 turbo                                         | Flat-4 (boxer)              | 1-3-2-4 [S]                                                              | even 180 deg crank; **uneven pulse arrival** from unequal runners [S] | 2         | [0,0,0,0] + runner delays (below)           | **[1.0,.65,1.0,.65]** [E, from S: loud then quiet pulse] | 850 [E]                               | EJ207 8000 [S]; 220-275 PS @6000-6500 [S]; GC8 WRX ~7500 [E]                             | 7600 [E]                                       |
| MX-5 NA (`mx5`)     | B6ZE(RS) 1.6                                       | I4                          | 1-3-4-2 [E]                                                              | even 180 deg                                                          | 2         | [.02,-.02,.01,-.01]                         | [1.0,.99,1.01,1.0]                                       | 850 [E]                               | 7200 redline [S]; 115-120 hp @6500 [S]                                                   | 7400 [E]                                       |

Runner delay for the WRX (flat-4 unequal-length headers, [S] that runner lengths differ and make the rumble; lengths [E]): per-cylinder primary length `[0.55,0.30,0.55,0.30]` m (long,short alternating in firing order, so strong/weak/strong/weak). Real EJ pairs cyl 1+4 / 2+3 at first collectors; model as two 2-input sums then merge.

### 1b. Exhaust, tone, aspiration

Lengths are **real** metres. Because the DSP uses `C_SOUND=343` but exhaust gas at 400-600 C is ~520-590 m/s, set `effective_len = real * 0.62` (or set `C_SOUND` per pipe to 540). `refl` negative = open end (odd quarter-wave resonances at c/(4L)*(2k+1)).

| Car   | Header primary (m)                     | Mid pipe (m)                  | Header refl / loss Hz | Pipe refl / loss Hz | Muffler lp [idle..wot] Hz / body Hz / rasp Hz | Pulse tau ms [wot..idle] | Intake band Hz / gain                           | Aspiration                           | Tone notes (what to hear)                                                                                         |
| ----- | -------------------------------------- | ----------------------------- | --------------------- | ------------------- | --------------------------------------------- | ------------------------ | ----------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| civic | 0.65 (4-2-1/4-1 tuned)                 | 1.6                           | -0.50 / 4000          | -0.50 / 2200        | 1100..3800 / 150 / 2200                       | 0.28..0.65               | 500-1500 / 0.30                                 | NA                                   | Raw hard I4 rasp; **VTEC step** at 5500: brighter, louder, intake honk, then wail to 8200                         |
| supra | 0.40 (log manifold to twin turbos)     | 2.4 (3" straight, big tail)   | -0.35 / 2800          | -0.50 / 1500        | 700..2400 / 90 / 1500                         | 0.40..0.90               | 300-1000 / 0.18                                 | Sequential twin turbo [S]            | Smooth I6 howl: strong 3rd/6th/9th order, low and round, deep body; turbo mutes the exhaust edge                  |
| rx7   | 0.30 (short, turbo manifold; port-fed) | 1.9 (dual/straight)           | -0.30 / 5000          | -0.30 / 3000        | 1800..5000 / 100 / 2600                       | 0.18..0.40 (sharp)       | 600-1800 / 0.12                                 | Sequential twin turbo [S]            | Buzzy sewing-machine rasp, little bass; idle: smooth hum when stock [S], "brap" lope when ported [S]              |
| r32   | 0.40                                   | 2.2 (twin to 3")              | -0.40 / 3200          | -0.50 / 1800        | 800..3000 / 110 / 1800                        | 0.35..0.75               | 700-2200 / **0.28** (6 ITBs [S])                | Parallel twin turbo T25 [S]          | Heavy low growl, metallic rasp climbing with rpm, strong induction snarl on blips, twin-whistle                   |
| s13   | 0.35 (cast log manifold)               | 1.8                           | -0.45 / 3500          | -0.55 / 1800        | 900..3200 / 130 / 1700                        | 0.40..0.70               | 500-1800 / 0.22                                 | Single T25 (stock) / T28 (tuned) [S] | Gruff mid-heavy I4, gravel; cat-back "fat" tone; flutter/BOV chirps                                               |
| 180sx | 0.35                                   | 2.2 (hatch, straight-through) | -0.40 / 3800          | -0.30 / 2800        | 1200..4200 / 140 / 2000                       | 0.35..0.65               | 500-1800 / 0.22                                 | Single T28/GT28-class [E]            | Same engine, tuned straight-pipe: louder, raspier, more drone and pops than S13                                   |
| ae86  | 0.60 (4-1)                             | 1.5                           | -0.50 / 4500          | -0.50 / 2400        | 1300..4200 / 160 / 2400                       | 0.22..0.50               | 600-1500 / **0.30** (ITB on 20V swap [S])       | NA                                   | High-pitched thin buzzy scream; intake suck/honk, valvetrain hiss; revs fast; no turbo                            |
| nsx   | 0.45 per bank (3-into-1 x2)            | 1.7                           | -0.40 / 3500          | -0.45 / 2000        | 900..3200 / 120 / 1900                        | 0.32..0.75               | 400-1200 / **0.30** (engine right behind cabin) | NA                                   | Smooth V6 wail (3rd order), two-bank burble, **VTEC step** ~5800 [S]; VVIS plenum at 4800 [S] changes intake tone |
| evo4  | 0.35                                   | 2.0                           | -0.45 / 3200          | -0.55 / 1700        | 800..2800 / 130 / 1500                        | 0.45..0.80               | 400-1400 / 0.20                                 | Single twin-scroll TD05-class [E]    | Gravelly truck-like I4 (heavy 2nd order), loud hiss, signature DV flutter                                         |
| wrx   | per-cyl [0.55,0.30,0.55,0.30]          | 1.9                           | -0.45 / 3000          | -0.55 / 1600        | 800..2800 / 120 / 1500                        | 0.45..0.85               | 400-1400 / 0.20                                 | Single TD05/VF-class [S]             | **Boxer burble**: strong-weak-strong-weak, order-1 rumble, low and lumpy, less top-end rasp                       |
| mx5   | 0.50                                   | 1.5                           | -0.45 / 3800          | -0.50 / 2000        | 1000..3200 / 140 / 1900                       | 0.35..0.70               | 500-1200 / 0.20                                 | NA                                   | Small tidy I4, tinny bark with a cat-back drone, intake hum, quiet mechanically                                   |

Stock vs tuned: all rows above are the **tuned street drift** target (free-flow cat-back/straight pipe, aftermarket header, BOV). Stock would be: lower `lp`, `rasp` gain x0.5, lengths longer (cat/muffler absorb), limiter at the factory number in 1a, BOV recirculating (quiet), no pops.

### 1c. Turbo, BOV, pops, limiter, VTEC

Spool = rpm at which boost starts (`spoolRpm`) and reaches full (`fullRpm`). Whine Hz range is `[lo,hi]` over spool 0..1. `tauUp/tauDown` seconds of turbo-speed state. All [E] unless noted.

| Car   | Turbo                                                                                                | spoolRpm / fullRpm                     | tauUp / tauDown | Whine Hz [lo..hi] / gain                                        | Hiss gain | BOV type / gain                     | BOV dur ms | Flutter (pulses, Hz)             | Wastegate                                        | Pop (overrun) rate/s, dur s, gain           | Limiter                                                                      |
| ----- | ---------------------------------------------------------------------------------------------------- | -------------------------------------- | --------------- | --------------------------------------------------------------- | --------- | ----------------------------------- | ---------- | -------------------------------- | ------------------------------------------------ | ------------------------------------------- | ---------------------------------------------------------------------------- |
| civic | none                                                                                                 | -                                      | -               | -                                                               | -         | -                                   | -          | -                                | -                                                | 6, 0.4, 0.15 (catless header crackle)       | hard fuel cut, 22 Hz stutter (Honda ECU)                                     |
| supra | sequential twin (stage 2 at ~4000-4500; changeover rpm not sourced, valves are known weak point [S]) | 2000 / 4200                            | 0.35 / 0.9      | 1400..4800 / 0.05, stage-2 tone x1.25 fades in over 150 ms      | 0.06      | atmospheric (tuned) / 0.8           | 350        | 3 pulses, 9 Hz (rare)            | internal, quiet                                  | 10, 0.6, 0.25                               | hard fuel cut 14 Hz                                                          |
| rx7   | sequential twin HT12-class (stage 2 ~4500 [S weak/forum, tunable])                                   | 2500 / 4500 + boost dip 120 ms at 4500 | 0.30 / 0.7      | 1800..5500 / 0.05                                               | 0.05      | dual recirc+atm / 0.6               | 250        | 4 pulses, 12 Hz                  | internal                                         | **18, 1.0, 0.40** (afterfire, ignition cut) | hard **ignition** cut 12 Hz + bang each cut                                  |
| r32   | parallel twin T25 ceramic, 0.7 bar wastegate, ~1 bar restrictor [S]                                  | 3000 / 4800                            | 0.40 / 0.8      | twin tones 1500..5200, detune +-3% (4-6 Hz beating) / 0.05 each | 0.07      | atmospheric x2 / 0.9                | 400        | 4 pulses, 10 Hz                  | external screamer, chatter 18 Hz above spool 0.9 | 12, 0.7, 0.30                               | hard fuel cut 15 Hz                                                          |
| s13   | single T25 stock (T28 tuned) [S]                                                                     | 2800 / 4300                            | 0.30 / 0.7      | 1800..5800 / 0.06                                               | 0.07      | atmospheric / 0.9                   | 330        | 5 pulses, 11 Hz                  | internal tss                                     | 14, 0.7, 0.30                               | **soft staged cut**: per-cylinder cut prob 0->0.75 over limit-200..limit [S] |
| 180sx | single GT28-class                                                                                    | 3000 / 4500                            | 0.35 / 0.8      | 1500..5200 / 0.07                                               | 0.08      | atmospheric big / 1.0               | 450        | 5 pulses, 10 Hz                  | external, chatter 22 Hz                          | 18, 0.9, 0.38                               | hard cut 14 Hz + pops                                                        |
| ae86  | none                                                                                                 | -                                      | -               | -                                                               | -         | -                                   | -          | -                                | -                                                | 8, 0.5, 0.20 (ITB lift-off crackle)         | hard cut 20 Hz                                                               |
| nsx   | none                                                                                                 | -                                      | -               | -                                                               | -         | -                                   | -          | -                                | -                                                | 3, 0.3, 0.10                                | hard cut 18 Hz                                                               |
| evo4  | single TD05HR-class twin-scroll [E]                                                                  | 3200 / 4300                            | 0.35 / 0.85     | 1600..5600 / 0.07                                               | 0.09      | stock DV leaks => **flutter** / 0.5 | 300        | **6 pulses, 14 Hz falling to 7** | internal                                         | 16, 0.8, 0.35 (mild ALS)                    | hard cut 13 Hz + pops                                                        |
| wrx   | single TD05/VF22-class [S]                                                                           | 3200 / 4400                            | 0.35 / 0.8      | 1500..5200 / 0.06                                               | 0.07      | atmospheric (tuned) / 0.8           | 320        | 4 pulses, 9 Hz                   | internal                                         | 14, 0.7, 0.32                               | hard cut 14 Hz                                                               |
| mx5   | none                                                                                                 | -                                      | -               | -                                                               | -         | -                                   | -          | -                                | -                                                | 4, 0.3, 0.12                                | hard fuel cut 20 Hz                                                          |

VTEC / cam crossover:

| Car           | rpmOn (rising)                                                         | rpmOff (falling) | Timbre step                                                                 |
| ------------- | ---------------------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------- |
| civic         | 5500 [S] (1st-gen B16A 4500, B16A1 5200, B16A2/A3 5600, B16B 6100 [S]) | 5200 [E]         | `bright`+0.25, tau x0.7, rasp x1.5, intake +4 dB, 40 ms crossfade           |
| nsx           | 5800-6000 [S]                                                          | 5500 [E]         | same, slightly smaller (+0.2); VVIS plenum: intake band -150 Hz at 4800 [S] |
| ae86 / others | none (4A-GE 16V Gen1-2 has T-VIS runner change [S], skip)              |                  |                                                                             |

---

## 2. Synthesis techniques in the pulse + waveguide model

### 2.1 Generic firing scheduler

Replace the hard-coded `& 3` and `*2` with profile data:

```
firesPerRev = cyl / 2           // I4 2, I6/V6 3, flat4 2; rotary: 2 (13B)
firePhase  += rpm/60 * firesPerRev / sr
on fire: i = (i+1) % n; fireAt = 1 + fireDt[i] + jitter; amp = fireAmp[i] * ...
```

Pulse repeats per 720 deg: `n` entries, not 4. Fire frequency `f = rpm/60*firesPerRev`: I4 at 6000 rpm = 200 Hz, I6 = 300 Hz, so pitch alone separates I4 from I6/V6. Game note: the 4 firing entries are in firing order, not cylinder number.

### 2.2 Order content (what the harmonic mix should look like)

- I4: dominant order 2 (fire freq) + 4, 6. Mild order 1/0.5 from `fireAmp`/`fireDt` scatter. Keep scatter at about +-3%.
- I6 (2JZ, RB26): dominant order 3 + 6, 9, 12; almost no sub-order content (even 120 deg, [S] firing order). Use scatter +-2% and longer pulses (higher tau) for the 2JZ's smooth howl; shorter tau + stronger rasp band (1.8 kHz) + ITB intake band for the RB26. Fire freq is 1.5x an I4 at the same rpm, which is the main cue.
- 90 deg V6 (NSX): 120 deg even via crankpin offset [S] so order 3 like an I6, but banks alternate (cyl 1,2,3 left / 4,5,6 right [S, rerev]). Model as two banks with different path (+-0.06 m) and amp `[1.03,.97,...]`: gives an order-1.5 burble. If you ever want a cheap uneven V6, the 90 deg non-offset crank fires 90/150/90/150/90/150 deg [E, standard knowledge]: `fireDt` = +-0.2 alternating.
- Flat-4 (WRX): crank interval is even [S], so the "rumble" comes from unequal runners: pulse amplitude pattern `[1,.65,1,.65]` repeating every 360 deg, which produces a strong **order 1** line (14-17 Hz at idle, felt as rumble) plus the normal order 2 ([S] Jalopnik: slowed recordings show a louder pulse followed by a quieter one). Add the per-cylinder runner delays (0.55 / 0.30 m, effective ~0.34 / 0.19 m after the 0.62 factor) so the two collectors resonate at different frequencies (quarter-wave at c=540: ~245 Hz and ~450 Hz) and beat against each other. Use a Waveguide per cylinder feeding two collectors, then the common pipe.

### 2.3 Pulse shape

- Current `t*exp(-t/tau)` (two cascaded leaky integrators) is fine for piston engines. Express tau in crank degrees for realism: `tau_ms = deg / (6*rpm/1000)`; e.g. 25 deg at 6000 rpm = 0.7 ms [E]. Offer `tauIdleMs..tauWotMs` as in the table.
- Rotary: exhaust port is uncovered abruptly with high residual pressure, so use a **single** leaky integrator (`s1` only, instant attack, exponential decay, tau 0.18-0.4 ms) plus 15% of an anti-phase echo (rarefaction) ~1.2 ms later. More high-frequency energy, less low end.
- Pulse turbulence (rasp): multiply by `1 + k*rand()` already done; set `k` per car (0.5 civic/rx7/r32, 0.25 supra/nsx).
- Pulse research context: pulse-train + resonator synthesis is the standard cheap approach: pulses aligned to the firing pattern (phase = cycle phase + cylinder offset), bipolar derivative-of-cosine pulse with harmonics decaying `exp(-0.5*k*lambda)`, an attack/decay envelope, noise modulated by throttle, resonators as feedback delays `y[n]=x[n]+g*h[n-L]` ([S] arXiv 2603.09391; Baldan/SDT waveguide intake-cylinder-exhaust-muffler chain [S]).

### 2.4 Header / pipe resonance and harmonic emphasis

- With negative end reflection the loop is a comb at odd multiples of `c/(4L)`. Pick `L` so the first resonance sits in the car's cruise-fire-frequency band: e.g. 2JZ `L_eff = 2.4*0.62 = 1.5 m` -> 57, 171, 285 Hz which lands on I6 order 3 at ~1700, 3400, 5700 rpm (drone). I4: `L_eff = 1.6*0.62 = 1.0 m` -> 86 Hz, 258 Hz...
- Lower `refl` magnitude and raise `lossHz` = straight pipe/no muffler (RX-7, 180SX); higher `refl`, lower `lossHz` = resonator/muffler, fatter and booming (2JZ, NSX).
- Two-band emphasis: `mufBody` (bp, 90-160 Hz, Q 1.4) for chest, `mufRasp` (bp 1.5-2.6 kHz, Q 2.5) for rasp; RB26/RX-7/civic bright, 2JZ/NSX dark. Make `mufLp` range per car as in table.
- Cheap mechanical layer: highpassed noise (4.5 kHz) amplitude 0.015*(0.2+rpmN) now; per-car 0.005 (Supra/NSX/MX-5) to 0.03 (AE86, RB26 gear whine, Civic VTEC).

### 2.5 Rotary brap (13B-REW)

Facts: stock rotaries idle with a smooth even hum like an inline-six; the brap/lope comes from port overlap letting exhaust reflux into the intake, from ported/modified engines, and from rough idle [S Slashgear]. Three pulses per rotor revolution = one per shaft rev per rotor [S Wikipedia], so two rotors fire 2/rev (same fire rate as an I4).
Synthesis, all per firing:

1. `pMiss(rpm) = pm0 * clamp(1 - (rpm-900)/2600, 0, 1)^1.5` with `pm0 = 0.25` (ported/tuned), 0 for stock. On a miss: amp *= `0.15 + 0.35*rand()` (partial burn) instead of skipping, because misfire in a rotary is partial.
2. Reflux echo: add a second smaller pulse (0.25 amp) 4-7 ms after the main pulse at rpm < 3500, fading to 0 at 4500 (overlap effect). This is what makes the pattern irregular ("brap-brap-brap" cadence of ~2 pulses/rev with doublets).
3. Slight random per-firing amp scatter +-12% at idle (stock +-3%), `fireDt` jitter +-3%.
4. Short single-integrator pulse (2.3) and wide-open straight-through exhaust (low refl, 5 kHz loss) for the buzzy top end. No valvetrain hiss.
5. Rotary overrun: afterfire is heavy (unburnt fuel on lift-off); use the 18/s, 1.0 s, 0.40 pop row.

### 2.6 VTEC / cam switch

State `vt` (0..1) with hysteresis: up at `rpmOn`, down at `rpmOff` (table 1c). Smooth `vt` with 40 ms one-pole. Effects: `bright += 0.25*vt`, `tau *= (1 - 0.3*vt)`, `rasp *= (1 + 0.5*vt)`, intake gain `+4 dB*vt`, overall `amp *= 1 + 0.15*vt`. Audible as a sudden "yo" in timbre and loudness without a pitch jump. Honda B16 crossover at 5500 rpm [S Wikipedia Honda B engine]; NSX 5800-6000 [S australiancar.reviews/Honda].

### 2.7 Idle and low-rpm character

- Idle rpm per car (table 1a) means `RPM_MIN` becomes per-car `idleRpm`, and `engineRpm(norm)` must map to `[idleRpm, limiterRpm]` per car. Today the worklet receives an already-converted rpm; either keep conversion in `audio.ts` via the active profile, or send `norm` and convert in the DSP.
- Idle lope for ported rotary and cammed 4A-GE: low-frequency amp modulation 1.5-4 Hz depth 0.15 on `fireAmp`.

---

## 3. Turbo synthesis (cheap, concrete)

All numbers [E] unless a [S] is attached. Physical basis: compressor tone is blade count x shaft frequency (blade-pass) [S patents]; flutter is compressor surge, repeated flow reversal after the throttle closes while the turbo spins fast [S Wikipedia blowoff valve]; BOV vents the excess boost, a "whoosh"/"pssh" [S]; atmospheric vs recirculating (diverter) [S]. Real blade-pass is often above audible band (up to ~30 kHz [S patent]), so the audible whistle is a lower-order/induction tone; synthesise it as a bandpass-limited sine pair.

### 3.1 Spool state

```
spoolTgt = thr * smoothstep(spoolRpm, fullRpm, rpm) ^ 1.3          // exhaust energy ~ throttle x rpm
S += (spoolTgt - S) * (1 - exp(-dt/tau))   tau = spoolTgt>S ? tauUp : tauDown   // 0.3-0.4 s up, 0.7-0.9 s down
boost = S                                                            // 0..1 drives whine, hiss, flutter, BOV
```

`tauDown` long means the whine sweeps down slowly after lift-off. This falling whistle is the main audible signature on lift.

### 3.2 Spool whine

- Frequency `fW = lo + (hi - lo) * S^0.8`; table 1c, typical `1500 -> 5500` Hz.
- Generate: `sin(phi)` + 0.35*`sin(2*phi)` + 0.15*`sin(3*phi)` (bandwidth-limit by `fW < 0.45*sr`), 7 Hz FM +-1% for realism, then bp at `fW` (Q 3) for cleanliness. Gain `gW * S^1.5` with `gW` 0.04-0.09 of engine level.
- Hiss: `rand()` through bp centre `0.6*fW`, Q 1.5, gain `gH * S * thr`, plus slow noise at 2-4 kHz breathing with rpm.
- Distinct signatures: twin parallel (RB26) = two whines detuned +-3% (beats at 4-6 Hz); sequential (2JZ, FD) = tone 1 from 2000 rpm, tone 2 (x1.25 freq, amp 0.6) fades in over 150 ms at ~4000-4500 rpm with a 100-150 ms boost dip on the FD (rotary exhaust energy is intermittent); single (S13, Evo, WRX) = one whine, bigger turbo (Evo/180SX) lower fW and later spool.

### 3.3 Blow-off valve (the "pssh")

Trigger: `thr` falls from `>0.5` to `<0.2` within 120 ms and `S > 0.35`.

- Atmospheric: noise -> hp 1.2 kHz -> bp, centre sweeping 4.5 kHz -> 2.0 kHz over the burst (Q 0.7). Envelope: attack 3 ms, hold 40 ms, decay `tau = 0.07 + 0.12*S` s; total 250-450 ms. Gain `gBov * S^0.7`. Add a 120 Hz sine "chuff" decaying in 25 ms at the start.
- Recirculating (stock diverter): same chain, gain x0.25, centre 2 kHz, 150 ms. The cue is the whine decay; nothing loud.
- Game rule: tuned = atmospheric on Supra, R32 (twin), S13, 180SX (big), WRX, RX-7 (dual); Evo uses leaking-DV flutter.

### 3.4 Compressor surge "flutter"

Trigger: same lift condition when BOV is restrictive or leaky (table 1c), or randomly (35%) on cars with an atmospheric BOV for a short 2-3 pulse "chirp".

- Pulses `n = 2 + round(5*S)` (3-6), rate `fF = 6 + 10*S` Hz starting at 8-16 Hz and falling ~25% over the burst. A lower rate for large boost. (Real surge frequency scales with piping volume; few Hz to ~20 Hz plausible [E]; no source gave a number.)
- Each pulse: whine tone dropped 12% in pitch (sag) + noise burst bp 2-4 kHz, envelope `exp(-t/0.025)`; amplitude `exp(-t/0.35)` over the burst. Cheap alternative: multiply whine + hiss by `0.5 + 0.5*square(2*pi*fF*t)`.
- Slashgear/Wikipedia-level sources call flutter the sound of surge; forum disagreement on terminology (BOV not releasing all air in one shot vs true surge) is noted in [S DSM thread]; for sound design treat as same effect.

### 3.5 Wastegate

- Internal (stock): negligible "tss" noise, bp 3 kHz, gain 0.01, only when `S > 0.9` and `thr > 0.8`.
- External (tuned S13, 180SX, R32): chatter. When `S > 0.9`, emit noise pulses at 18-25 Hz (jittered +-20%), each 8-15 ms, bp 1.5-3 kHz, gain 0.02-0.04. Optionally a sustained "scream" hiss `gWG * (S - 0.85)`.

### 3.6 Anti-lag / backfire / overrun pops

- Mechanism: ignition heavily retarded (about 35-45 deg ATDC) plus cylinder ignition cuts burns fuel in the exhaust and drives the turbo; loud pops and flames; works off-throttle when air is bypassed [S hpacademy, forum]. Overrun pops on a tune are the same effect, weaker.
- Model per pop (poisson process): rate `lambda(t) = lambda0 * exp(-t/T)` (table 1c "rate/s, dur s"). Each pop: pulse of amp `gPop * logn(0.5)`, `cubed noise -> hp 700 Hz` for 8-25 ms (existing `r*r*r` trick) + 70-110 Hz sine thump 40 ms. Armed when rpm > 3000 (4500 for ALS-style cars) and `thr < 0.1` for >60 ms after having been >0.15 (existing arming logic).
- Types: **NA overrun crackle** (Civic catless, AE86 ITB, MX-5): 4-8/s, short (0.3-0.5 s), small amp. **Turbo overrun burble** (tuned S13/180SX/R32/WRX): 12-18/s, 0.7-0.9 s. **ALS-style bangs** (Evo, RX-7): 16-18/s, loudest, sustained while off-throttle; add a 400 Hz low-pass "whoomph" (flame) on every 4th pop. Rotary: heaviest because of unburnt fuel.
- Existing code only supports one pop profile (`popTime` 0.3-0.8 s at rpm>3500, 25% of firings). Parameterise `popRpm`, `popProb`, `popTime`, `popGain`.

---

## 4. Rev limiter behaviour

Source: fuel-cut limiter is most common on road cars; spark cut is rarer and sends fuel to the exhaust (pops/flames); hard cut drops/recovers repeatedly (bouncing with hysteresis); soft cut reduces fuel/retards timing before the limit and may cut cylinders one at a time [S Wikipedia Rev limiter]. SR20 stock ECU: staged cut, one cylinder at a time, start ~7300 and finish at 7500 [S sr20forum]. Hz/pop details are [E].

Implementation (inside the fire loop):

- **Hard cut** (Honda, Toyota, aftermarket Haltech/F-CON style): if `rpm >= limit` set `cut = true`; clear when `rpm <= limit - hyst` (hyst 80-150 rpm) or, if physics holds rpm flat, gate with a square wave of `fLim` Hz (table 1c), duty 55% cut. While `cut`, skip impulses (the exhaust waveguide keeps ringing, giving the natural fading pulses). Civic/MX-5/AE86/NSX: fuel cut, 18-22 Hz, clean stutter. Supra/R32/WRX: 14-15 Hz, deeper bounce. Rotary and tuned turbo cars: ignition cut: same gate plus a pop at 50% of cuts (bang-bang-bang).
- **Soft cut** (stock Nissan SR): per-firing cut probability `p = clamp((rpm - (limit-200)) / 200, 0, 1) * 0.75`; skipped firings sound like misses/roughness before the hard wall; combine with throttle-closed look.
- Limiter also caps `rpm` at `limit` in the DSP smoothing so the sound plateaus; do not let the sound exceed `limit*1.02`.

Overrun pops by car type: see 3.6 and the "Pop" column in 1c. In brief: NA (NSX none to very light, Civic light, MX-5 light, AE86 light-medium with ITB), turbo tuned medium (Supra, R32, S13, 180SX, WRX), ALS-style heavy (Evo, RX-7).

---

## 5. Distinctness matrix (what changes between similar cars)

- **I4 NA (Civic, AE86, MX-5):** differ by redline/limiter, pulse sharpness, intake (AE86 ITB honk), VTEC step (Civic only).
- **I4 turbo (S13, 180SX, Evo, WRX):** S13 vs 180SX differ by exhaust (cat-back vs straight), turbo size (T25 vs GT28), limiter type (soft staged vs hard); Evo = flutter + gravel; WRX = unequal-length rumble (order 1).
- **I6 (Supra, R32):** same pitch behaviour, differ by smooth/dark (2JZ, sequential, round howl) vs rasp/ITB/twin whistle (RB26).
- **V6 (NSX):** 3rd order like an I6 but bank burble + VTEC + VVIS.
- **Rotary (RX-7):** only car with a different pulse (single-integrator), reflux doublets and lope; quiet bass, buzzy top, ignition-cut bangs.

Gain staging: normalise each car's output by RMS so the table does not make cars louder or quieter than each other (`audio.ts` uses a fixed `engGain` 0.35).

---

## 6. Sources

Engine specs, layout, orders:

- Honda B engine (B16A variants, VTEC 5500, redline 8200): https://en.wikipedia.org/wiki/Honda_B_engine
- Honda C engine (C30A 120 deg via offset crankpins, VVIS 4800, C32B): https://en.wikipedia.org/wiki/Honda_C_engine
- Honda NSX C30A tech page (8000 MT / 7500 AT redline, 280 PS @7300): https://global.honda/jp/tech/engine/car/C30A_NSX_vtec_DOHC/ and https://www.honda.co.jp/sportscar/vtec_history/C30A/
- NSX VTEC 5800-6000 / auto redline 7200: https://australiancar.reviews/review-honda-na1-na2-nsx-1991-04/
- Honda V6 firing order 1-4-2-5-3-6 (family): https://rerev.com/firing-orders/honda/3-0l/
- Toyota JZ engine (2JZ-GTE sequential twin, 320 hp @5600): https://en.wikipedia.org/wiki/Toyota_JZ_engine
- 2JZ-GTE changeover caveat: https://www.jdmbuysell.com/learn/engines/2jz-gte/
- Nissan RB engine (RB26: parallel twin T25, 0.7 bar, 6 throttle bodies): https://en.wikipedia.org/wiki/Nissan_RB_engine
- RB26 firing order 1-5-3-6-2-4 / sound: https://www.carthrottle.com/posts/why-does-rb26dett-sound-nothing-bmws-n54-x35i-engine-both-are-twin-turbo-i6s-1-5-3-6-2-4 ; redline 8000: https://www.jdmbuysell.com/learn/engines/rb26dett/
- Nissan SR engine / SR20DET: https://en.wikipedia.org/wiki/Nissan_SR_engine ; https://www.jdmbuysell.com/learn/engines/sr20det/ (CA18DET on earlier K's)
- SR20DET rev limit (staged fuel cut ~7300-7500): https://sr20forum.nfshost.com/tuning/!1369-stock-rev-limit-what-is-it.html
- Toyota A engine (4A-GE redlines, ITB on 20V): https://en.wikipedia.org/wiki/Toyota_A_engine
- Subaru EJ engine (1-3-2-4, EJ207 8000, rumble from long runners on cyl 2 and 4, TD04/TD05/VF22): https://en.wikipedia.org/wiki/Subaru_EJ_engine
- Unequal length headers (louder pulse followed by quieter): https://www.jalopnik.com/1933843/subaru-unequal-header-length-exhaust-sound/ ; https://www.slashgear.com/1970710/subaru-unequal-length-headers-rumble-sound
- Mazda B engine (B6ZE(RS) 7200 redline, 115-120 hp @6500): https://en.wikipedia.org/wiki/Mazda_B_engine
- 4G63 firing order 1-3-4-2: https://www.dsmtuners.com/threads/2g-4g63-question-on-firing-order.467804/
- Lancer Evolution (280 PS gentleman's agreement): https://en.wikipedia.org/wiki/Mitsubishi_Lancer_Evolution
- Wankel engine (three power pulses per rotor revolution = 1 per shaft rev): https://en.wikipedia.org/wiki/Wankel_engine
- 13B-REW power (255 -> 280 PS) : https://bestcarweb.jp/feature/column/292616?prd=3 ; changeover ~4500 (weak): https://www.ifixit.com/Device/Mazda_RX-7
- Rotary brap explanation (stock smooth hum, overlap reflux): https://www.slashgear.com/1879127/rotary-engine-brap-sound-reason/
- Firing order / intervals (I4 1-3-4-2, I6 1-5-3-6-2-4, flat-4 R1-R2-L1-L2, 720/cyl): https://en.wikipedia.org/wiki/Firing_order

Turbo, BOV, limiter, pops:

- Blowoff valve (flutter = surge, atmospheric vs recirculating): https://en.wikipedia.org/wiki/Blowoff_valve
- Compressor stall/surge (loud bangs on gas turbines; stall cells 20-70% rotor speed): https://en.wikipedia.org/wiki/Compressor_stall
- Blade-pass frequency tone of turbo compressors: https://patents.google.com/patent/US5635646 and https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/7283923
- Flutter vs BOV terminology: https://www.dsmtuners.com/threads/compressor-surge-b-o-v.351232/
- Rev limiter types: https://en.wikipedia.org/wiki/Rev_limiter
- Anti-lag / 2-step / pops: https://hpacademy.com/q-and-a/anti-lag-vs-2-step-launch-control-not-just-for-pops-and-bangs

Synthesis methods:

- Baldan & Delle Monache, procedural engine sound (waveguides, intake-cylinder-exhaust-muffler): https://air.iuav.it/handle/11578/264484 ; Sound Design Toolkit motor module: https://sdt.lim.di.unimi.it/docs/API/v2.2-078/group__motor.html
- Pulse-Train-Resonator model (pulses aligned to firing order, Karplus-Strong exhaust resonators, throttle-gated noise): https://arxiv.org/html/2603.09391
