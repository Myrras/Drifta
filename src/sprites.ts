import type { CarModel, PlayerModel } from './types';
import { CAR_MODELS, PLAYER_MODELS } from './models';

type Ctx = CanvasRenderingContext2D;
/** [x, half width] in m, listed nose to tail; mirrored across the x axis */
type P = [number, number];
/** front x, front half width, rear x, rear half width, corner radius, front bow, rear bow */
type Trap = [number, number, number, number, number, number, number];

interface Spec {
  /** wheelbase, front overhang (m) */
  wb: number;
  fo: number;
  body: P[];
  /** greenhouse (all glass) and the roof panel on top of it */
  glass: Trap;
  roof: Trap;
  mirror: number;
  /** y of the roof highlight stripes */
  stripes?: number[];
  detail: (g: Ctx, color: string) => void;
}

const TIRE = '#111214';
const GLASS = '#0d1014';
const HEAD = 'rgba(225,228,210,0.55)';
const TAIL = '#5a0b12';
const TRIM = '#17181b';
const SHADE = 'rgba(0,0,0,0.3)';

/** Smooth closed outline through the midpoints of the mirrored profile. */
function shape(g: Ctx, pts: P[]) {
  const loop: P[] = [...pts.map(([x, w]): P => [x, -w]), ...pts.filter((p) => p[1] > 0).reverse()];
  const n = loop.length;
  const mid = (a: P, b: P): P => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  g.beginPath();
  g.moveTo(...mid(loop[n - 1], loop[0]));
  for (let i = 0; i < n; i++) {
    const m = mid(loop[i], loop[(i + 1) % n]);
    g.quadraticCurveTo(loop[i][0], loop[i][1], m[0], m[1]);
  }
  g.closePath();
}

function fill(g: Ctx, style: string, pts: P[]) {
  g.fillStyle = style;
  shape(g, pts);
  g.fill();
}

/** Rounded trapezoid with bowed front and rear edges (cabin glass, roof). */
function trap(g: Ctx, style: string, [xf, wf, xr, wr, r, bf, br]: Trap) {
  g.fillStyle = style;
  g.beginPath();
  g.moveTo(xf - r, -wf);
  g.quadraticCurveTo(xf, -wf, xf, -wf + r);
  g.quadraticCurveTo(xf + 2 * bf, 0, xf, wf - r);
  g.quadraticCurveTo(xf, wf, xf - r, wf);
  g.lineTo(xr + r, wr);
  g.quadraticCurveTo(xr, wr, xr, wr - r);
  g.quadraticCurveTo(xr - 2 * br, 0, xr, -wr + r);
  g.quadraticCurveTo(xr, -wr, xr + r, -wr);
  g.closePath();
  g.fill();
}

/** Rect at (x, y, w, h) plus its mirror across the x axis, filled with each style in turn. */
function pair(
  g: Ctx,
  styles: string[],
  x: number,
  y: number,
  w: number,
  h: number,
  r: number | number[] = 0.03,
) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
  g.roundRect(x, -y - h, w, h, r);
  for (const s of styles) {
    g.fillStyle = s;
    g.fill();
  }
}

/** Panel spanning the car at x..x+d, half span s; `lift` sets the shadow offset (taller = further). */
function wing(g: Ctx, color: string, x: number, d: number, s: number, lift: number) {
  g.fillStyle = 'rgba(0,0,0,0.4)';
  g.beginPath();
  g.roundRect(x - lift, -s + lift * 0.5, d, 2 * s, 0.05);
  g.fill();
  g.beginPath();
  g.roundRect(x, -s, d, 2 * s, 0.05);
  g.fillStyle = color;
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.12)';
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.45)';
  g.lineWidth = 0.03;
  g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.22)'; // leading edge gloss
  g.fillRect(x + d - 0.06, -s + 0.06, 0.035, 2 * s - 0.12);
}

/** Pop-up headlight lids: body-colored panels with a shut line. */
function lids(g: Ctx, color: string, x: number, y: number, w: number, h: number) {
  pair(g, [color, 'rgba(255,255,255,0.06)'], x, y, w, h, 0.04);
  g.strokeStyle = 'rgba(0,0,0,0.6)';
  g.lineWidth = 0.03;
  g.stroke();
}

function line(g: Ctx, style: string, lw: number, x1: number, y1: number, x2: number, y2: number) {
  g.strokeStyle = style;
  g.lineWidth = lw;
  g.beginPath();
  g.moveTo(x1, y1);
  g.lineTo(x2, y2);
  g.stroke();
}

/** Dark slots across x..x+d at y, n slots (hood vents, engine cover). */
function slots(g: Ctx, x: number, y: number, d: number, w: number, n: number) {
  for (let i = 0; i < n; i++) {
    const sx = x + (i + 0.5) * (d / n);
    line(g, 'rgba(0,0,0,0.55)', 0.04, sx, y - w, sx, y + w);
    line(g, 'rgba(0,0,0,0.55)', 0.04, sx, -y - w, sx, -y + w);
  }
}

function specs(model: CarModel, hl: number, B: number): Spec {
  const t = -hl;
  switch (model) {
    case 'civic':
      return {
        wb: 2.57,
        fo: 0.8,
        body: [
          [hl, 0.4],
          [hl - 0.04, 0.6],
          [hl - 0.25, B - 0.03],
          [hl - 0.6, B],
          [t + 0.35, B],
          [t + 0.06, B - 0.03],
          [t, B - 0.2],
        ],
        glass: [1.0, B - 0.1, -1.72, B - 0.1, 0.15, 0.08, 0.03],
        roof: [0.45, B - 0.16, -1.3, B - 0.15, 0.1, 0.05, 0.02],
        mirror: 0.55,
        detail(g, c) {
          pair(g, [HEAD], hl - 0.24, 0.28, 0.18, 0.4, [0.02, 0.12, 0.02, 0.02]);
          pair(g, [TAIL], t + 0.01, 0.32, 0.07, 0.38);
          wing(g, c, -1.42, 0.16, B - 0.2, 0.04); // roof spoiler
        },
      };
    case 'supra':
      return {
        wb: 2.55,
        fo: 0.95,
        body: [
          [hl, 0.35],
          [hl - 0.05, 0.62],
          [hl - 0.3, B - 0.02],
          [hl - 0.85, B],
          [-0.2, B - 0.05],
          [t + 0.75, B],
          [t + 0.25, B - 0.06],
          [t + 0.02, B - 0.35],
          [t, 0],
        ],
        glass: [0.48, B - 0.12, -1.5, B - 0.2, 0.3, 0.05, 0.05],
        roof: [0.0, B - 0.18, -1.0, B - 0.26, 0.25, 0.03, 0.03],
        mirror: 0.3,
        detail(g, c) {
          pair(g, [HEAD], hl - 0.42, 0.36, 0.34, 0.3, 0.13);
          pair(g, [TAIL], t + 0.1, 0.3, 0.16, 0.16, 0.08);
          pair(g, [TAIL], t + 0.28, B - 0.24, 0.16, 0.16, 0.08);
          // hoop wing: legs rise from the rear fenders, plane spans the tail
          pair(g, [c, SHADE], -1.95, B - 0.14, 0.42, 0.1, 0.05);
          wing(g, c, -2.0, 0.26, B - 0.05, 0.08);
        },
      };
    case 'rx7':
      return {
        wb: 2.425,
        fo: 0.85,
        body: [
          [hl, 0.18],
          [hl - 0.06, 0.42],
          [hl - 0.4, B - 0.12],
          [hl - 0.85, B],
          [hl - 1.5, B - 0.14],
          [0.0, B - 0.17],
          [-0.6, B - 0.1],
          [-1.13, B],
          [t + 0.35, B - 0.08],
          [t + 0.06, B - 0.32],
          [t, 0],
        ],
        glass: [0.58, B - 0.26, -1.5, B - 0.24, 0.3, 0.04, 0.05],
        roof: [0.05, B - 0.33, -0.82, B - 0.32, 0.2, 0.02, 0.02],
        mirror: 0.32,
        stripes: [-0.2, 0.2],
        detail(g, c) {
          line(g, 'rgba(0,0,0,0.35)', 0.06, 0.02, 0, -0.78, 0); // double-bubble groove
          lids(g, c, hl - 0.62, 0.24, 0.3, 0.2);
          pair(g, [HEAD], hl - 0.2, 0.12, 0.1, 0.2, 0.04);
          pair(g, [TAIL], t + 0.12, 0.18, 0.08, 0.36, 0.04);
          // integrated rear wing between the fenders
          g.fillStyle = 'rgba(0,0,0,0.35)';
          shape(g, [
            [t + 0.34, 0],
            [t + 0.3, B - 0.15],
            [t + 0.16, B - 0.15],
            [t + 0.2, 0],
          ]);
          g.fill();
          line(g, 'rgba(255,255,255,0.2)', 0.03, t + 0.3, -(B - 0.2), t + 0.3, B - 0.2);
        },
      };
    case 'r32':
      return {
        wb: 2.615,
        fo: 0.9,
        body: [
          [hl, 0.5],
          [hl, B - 0.08],
          [hl - 0.08, B - 0.06],
          [1.8, B - 0.06],
          [1.38, B],
          [0.95, B - 0.06],
          [-0.8, B - 0.06],
          [-1.24, B],
          [-1.65, B - 0.06],
          [t + 0.08, B - 0.06],
          [t, B - 0.08],
          [t, 0.5],
        ],
        glass: [0.78, B - 0.13, -1.38, B - 0.14, 0.06, 0.04, 0.02],
        roof: [0.28, B - 0.19, -0.88, B - 0.2, 0.05, 0.02, 0],
        mirror: 0.6,
        detail(g, c) {
          pair(g, [HEAD], hl - 0.12, 0.36, 0.1, 0.34, 0.01);
          for (const y of [0.3, 0.55]) pair(g, [TAIL], t + 0.01, y - 0.08, 0.06, 0.16, 0.03);
          line(g, 'rgba(0,0,0,0.3)', 0.03, hl - 0.15, -(B - 0.12), hl - 0.15, B - 0.12); // grille line
          pair(g, [c, SHADE], t + 0.08, -0.0, 0.12, B - 0.12, 0.02); // trunk lip spoiler
        },
      };
    case 's13':
      return {
        wb: 2.475,
        fo: 0.85,
        body: [
          [hl, 0.45],
          [hl - 0.02, B - 0.16],
          [hl - 0.2, B - 0.08],
          [1.0, B - 0.02],
          [-0.5, B],
          [t + 0.3, B],
          [t + 0.04, B - 0.05],
          [t, 0.5],
        ],
        glass: [0.62, B - 0.12, -1.4, B - 0.15, 0.12, 0.07, 0.03],
        roof: [0.12, B - 0.18, -0.95, B - 0.2, 0.1, 0.04, 0.02],
        mirror: 0.48,
        detail(g) {
          pair(g, [HEAD], hl - 0.11, 0.24, 0.08, B - 0.38, 0.02);
          pair(g, [TAIL], t + 0.01, 0.12, 0.07, B - 0.2);
          line(g, 'rgba(0,0,0,0.35)', 0.03, -1.52, -(B - 0.12), -1.52, B - 0.12); // trunk shut line
        },
      };
    case '180sx':
      return {
        wb: 2.475,
        fo: 0.9,
        body: [
          [hl, 0.4],
          [hl - 0.06, B - 0.14],
          [hl - 0.3, B - 0.05],
          [1.0, B - 0.02],
          [-0.5, B],
          [t + 0.3, B],
          [t + 0.04, B - 0.05],
          [t, 0.5],
        ],
        glass: [0.62, B - 0.12, -1.92, B - 0.2, 0.15, 0.07, 0.06],
        roof: [0.12, B - 0.18, -0.82, B - 0.2, 0.1, 0.04, 0.03],
        mirror: 0.48,
        detail(g, c) {
          lids(g, c, hl - 0.62, 0.22, 0.42, B - 0.34);
          pair(g, [HEAD], hl - 0.08, 0.3, 0.05, 0.3, 0.02);
          pair(g, [TAIL], t + 0.01, 0.06, 0.07, B - 0.14);
          pair(g, [c, 'rgba(0,0,0,0.22)'], t + 0.09, 0, 0.16, B - 0.1, 0.02); // ducktail
          line(g, 'rgba(255,255,255,0.2)', 0.03, t + 0.23, -(B - 0.14), t + 0.23, B - 0.14);
        },
      };
    case 'ae86':
      return {
        wb: 2.4,
        fo: 0.8,
        body: [
          [hl, 0.5],
          [hl - 0.01, B - 0.08],
          [hl - 0.08, B - 0.02],
          [t + 0.1, B - 0.02],
          [t + 0.01, B - 0.08],
          [t, 0.5],
        ],
        glass: [0.74, B - 0.06, -1.46, B - 0.1, 0.05, 0.03, 0.02],
        roof: [0.32, B - 0.13, -1.02, B - 0.15, 0.04, 0.02, 0],
        mirror: 0.6,
        detail(g, c) {
          g.save();
          shape(g, this.body);
          g.clip();
          g.fillStyle = TRIM; // black bumpers and sills
          g.fillRect(hl - 0.16, -B, 0.2, 2 * B);
          g.fillRect(t - 0.04, -B, 0.2, 2 * B);
          g.fillRect(-1.1, -B, 2.4, 0.06);
          g.fillRect(-1.1, B - 0.06, 2.4, 0.06);
          g.restore();
          lids(g, c, hl - 0.58, 0.22, 0.36, 0.3);
          pair(g, [HEAD], hl - 0.11, 0.3, 0.06, 0.2, 0.02);
          pair(g, [TAIL], t + 0.16, 0.14, 0.06, B - 0.24, 0.01);
        },
      };
    case 'nsx':
      return {
        wb: 2.53,
        fo: 0.95,
        body: [
          [hl, 0.35],
          [hl - 0.05, 0.62],
          [hl - 0.35, B - 0.04],
          [1.27, B],
          [0.0, B - 0.06],
          [-1.27, B],
          [t + 0.12, B - 0.02],
          [t, B - 0.06],
        ],
        glass: [1.05, B - 0.16, -0.74, B - 0.24, 0.25, 0.06, 0.02],
        roof: [0.5, B - 0.22, -0.48, B - 0.3, 0.16, 0.03, 0.01],
        mirror: 0.85,
        detail(g, c) {
          lids(g, c, hl - 0.62, 0.22, 0.4, 0.3);
          pair(g, [HEAD], hl - 0.1, 0.3, 0.06, 0.26, 0.02);
          pair(g, [SHADE], -1.65, 0.0, 0.8, 0.45, 0.06); // engine cover
          slots(g, -1.62, 0.22, 0.74, 0.18, 6);
          pair(g, [TAIL], t + 0.0, 0.0, 0.06, B - 0.1, 0.01);
          wing(g, c, t + 0.08, 0.2, B - 0.03, 0.04); // full-width tail spoiler
        },
      };
    case 'evo4':
      return {
        wb: 2.51,
        fo: 0.85,
        body: [
          [hl, 0.45],
          [hl - 0.03, B - 0.1],
          [hl - 0.2, B - 0.03],
          [1.3, B],
          [t + 0.3, B],
          [t + 0.05, B - 0.05],
          [t, 0.5],
        ],
        glass: [0.72, B - 0.11, -1.34, B - 0.15, 0.1, 0.06, 0.03],
        roof: [0.22, B - 0.17, -0.86, B - 0.2, 0.08, 0.03, 0.02],
        mirror: 0.6,
        detail(g, c) {
          pair(g, [HEAD], hl - 0.2, 0.34, 0.16, 0.34, [0.02, 0.02, 0.02, 0.1]);
          pair(g, [TRIM], hl - 0.06, 0.0, 0.05, 0.28, 0.01); // intercooler opening
          pair(g, [SHADE], hl - 1.05, 0.14, 0.36, 0.34, 0.05); // hood vents
          slots(g, hl - 1.03, 0.31, 0.32, 0.13, 4);
          pair(g, [TAIL], t + 0.01, 0.3, 0.07, B - 0.38);
          pair(g, [c, SHADE], t + 0.2, B - 0.12, 0.16, 0.08, 0.02); // end plates
          wing(g, c, t + 0.12, 0.28, B - 0.06, 0.08);
        },
      };
    case 'wrx':
      return {
        wb: 2.52,
        fo: 0.85,
        body: [
          [hl, 0.4],
          [hl - 0.05, B - 0.12],
          [hl - 0.3, B - 0.03],
          [1.3, B],
          [t + 0.35, B],
          [t + 0.08, B - 0.06],
          [t, 0.45],
        ],
        glass: [0.76, B - 0.12, -1.36, B - 0.18, 0.16, 0.08, 0.05],
        roof: [0.24, B - 0.18, -0.88, B - 0.23, 0.14, 0.05, 0.04],
        mirror: 0.6,
        detail(g, c) {
          pair(g, [HEAD], hl - 0.22, 0.38, 0.18, 0.28, [0.02, 0.14, 0.02, 0.02]);
          // hood scoop: raised panel with a dark mouth at the front
          g.beginPath();
          g.roundRect(hl - 1.25, -0.3, 0.6, 0.6, 0.08);
          g.fillStyle = 'rgba(0,0,0,0.35)';
          g.fill();
          g.beginPath();
          g.roundRect(hl - 1.22, -0.27, 0.54, 0.54, 0.07);
          g.fillStyle = c;
          g.fill();
          g.fillStyle = 'rgba(255,255,255,0.1)';
          g.fill();
          g.fillStyle = TRIM;
          g.fillRect(hl - 0.76, -0.22, 0.08, 0.44);
          pair(g, [TAIL], t + 0.01, 0.28, 0.07, B - 0.36);
          pair(g, [TRIM], t + 0.3, B - 0.22, 0.12, 0.06, 0.02); // tall uprights
          wing(g, c, t + 0.26, 0.22, B - 0.14, 0.16);
        },
      };
  }
}

/** Draws a parked car centered at the origin, nose toward +x, 1 unit = 1 m (caller sets the transform). */
export function drawParkedCar(ctx: CanvasRenderingContext2D, model: CarModel, color: string): void {
  const g = ctx;
  const { length, width } = CAR_MODELS[model];
  const hl = length / 2;
  const B = width / 2 - 0.1; // body half width; tires peek out 0.1 m
  const s = specs(model, hl, B);
  const fa = hl - s.fo;
  g.save();
  for (const x of [fa, fa - s.wb]) pair(g, [TIRE], x - 0.31, B - 0.2, 0.62, 0.3, 0.07);
  fill(g, color, s.body);
  g.save();
  g.clip();
  g.strokeStyle = 'rgba(0,0,0,0.07)'; // darker toward the edges
  for (const lw of [0.7, 0.55, 0.4, 0.28, 0.18, 0.1]) {
    g.lineWidth = lw;
    g.stroke();
  }
  g.strokeStyle = 'rgba(255,255,255,0.14)'; // rim light
  g.lineWidth = 0.05;
  g.stroke();
  g.restore();
  pair(g, [color, SHADE], s.mirror - 0.07, B - 0.02, 0.14, 0.11, 0.03);
  const [gx, gw] = s.glass;
  trap(g, GLASS, s.glass);
  line(g, 'rgba(255,255,255,0.16)', 0.035, gx - 0.08, -(gw - 0.18), gx - 0.08, gw - 0.18);
  trap(g, color, s.roof);
  g.fillStyle = 'rgba(255,255,255,0.07)';
  g.fill();
  const [r1, , r2] = s.roof;
  g.fillStyle = 'rgba(255,255,255,0.16)'; // roof highlight
  for (const y of s.stripes ?? [0]) {
    g.beginPath();
    g.roundRect(r2 + 0.14, y - 0.08, r1 - r2 - 0.28, 0.16, 0.08);
    g.fill();
  }
  s.detail(g, color);
  g.restore();
}

/** NA roadster: short, rounded, pop-up lids, open cockpit with two seats and roll hoops. */
function drawMx5(g: Ctx, color: string): void {
  const hl = PLAYER_MODELS.mx5.length / 2;
  const B = PLAYER_MODELS.mx5.width / 2 - 0.1;
  const fa = hl - 0.9;
  g.save();
  for (const x of [fa, fa - 2.27]) pair(g, [TIRE], x - 0.29, B - 0.2, 0.58, 0.3, 0.07);
  fill(g, color, [
    [hl, 0.42],
    [hl - 0.06, 0.58],
    [hl - 0.3, B - 0.02],
    [hl - 0.8, B],
    [-0.1, B - 0.02],
    [-hl + 0.7, B],
    [-hl + 0.2, B - 0.06],
    [-hl + 0.02, B - 0.3],
    [-hl, 0],
  ]);
  g.save();
  g.clip();
  g.strokeStyle = 'rgba(0,0,0,0.07)'; // darker toward the edges
  for (const lw of [0.7, 0.55, 0.4, 0.28, 0.18, 0.1]) {
    g.lineWidth = lw;
    g.stroke();
  }
  g.strokeStyle = 'rgba(255,255,255,0.14)';
  g.lineWidth = 0.05;
  g.stroke();
  g.restore();
  lids(g, color, hl - 0.8, 0.32, 0.36, 0.3); // shut pop-up lids
  pair(g, [HEAD], hl - 0.2, 0.34, 0.14, 0.26, 0.06);
  pair(g, [TAIL], -hl + 0.01, 0.3, 0.07, 0.34);
  line(g, 'rgba(0,0,0,0.35)', 0.03, 0.3, -B + 0.1, 0.3, B - 0.1); // hood shut line
  // open cockpit with two seats
  g.fillStyle = '#1b1c20';
  g.beginPath();
  g.roundRect(-1.05, -B + 0.1, 1.2, 2 * B - 0.2, 0.2);
  g.fill();
  pair(g, ['#2a2b30', 'rgba(255,255,255,0.08)'], -0.75, 0.1, 0.42, 0.38, 0.1);
  trap(g, GLASS, [0.42, B - 0.1, 0.18, B - 0.1, 0.05, 0.04, 0]); // low windshield
  pair(g, ['#101114'], -0.9, 0.5, 0.1, 0.12, 0.03); // roll hoops
  pair(g, [color, SHADE], 0.3, B - 0.02, 0.14, 0.11, 0.03); // mirrors
  g.restore();
}

/** Draws any player model centered at the origin, nose toward +x, 1 unit = 1 m. */
export function drawCar(ctx: CanvasRenderingContext2D, model: PlayerModel, color: string): void {
  if (model === 'mx5') drawMx5(ctx, color);
  else drawParkedCar(ctx, model, color);
}
