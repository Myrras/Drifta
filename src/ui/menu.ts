import type { HudView, MenuRow } from '../view';
import { drawCar } from '../sprites';

const FONT = '"Segoe UI", system-ui, sans-serif';
const SKEW = -0.2;

interface Opts {
  align?: CanvasTextAlign;
  weight?: number;
  italic?: boolean;
  stroke?: string;
}

function text(
  g: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  size: number,
  fill: string,
  o: Opts = {},
): void {
  g.save();
  g.font = `${o.italic ? 'italic ' : ''}${o.weight ?? 800} ${size}px ${FONT}`;
  g.textAlign = o.align ?? 'left';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = Math.max(2, size * 0.16);
  g.strokeStyle = o.stroke ?? 'rgba(0,0,0,0.75)';
  g.strokeText(s, x, y);
  g.fillStyle = fill;
  g.fillText(s, x, y);
  g.restore();
}

/** Skewed plate centered on (cx, cy). */
function plate(
  g: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  w: number,
  h: number,
  on: boolean,
): void {
  g.save();
  g.transform(1, 0, SKEW, 1, cx, cy);
  g.fillStyle = on ? 'rgba(232,38,43,0.92)' : 'rgba(10,10,14,0.7)';
  g.fillRect(-w / 2, -h / 2, w, h);
  g.fillStyle = on ? '#ffd23f' : 'rgba(255,255,255,0.18)';
  g.fillRect(-w / 2, -h / 2, h * 0.12, h);
  g.restore();
}

function hints(g: CanvasRenderingContext2D, s: string, w: number, h: number, u: number): void {
  text(g, s, w / 2, h - 5 * u, 2.4 * u, '#ddd', { align: 'center', weight: 700 });
}

function rows(
  g: CanvasRenderingContext2D,
  list: MenuRow[],
  sel: number,
  w: number,
  top: number,
  u: number,
): void {
  const pw = 62 * u;
  const ph = 8 * u;
  list.forEach((r, i) => {
    const y = top + i * 10 * u;
    const on = i === sel;
    plate(g, w / 2, y, pw, ph, on);
    const x0 = w / 2 - pw / 2 + 3 * u;
    const x1 = w / 2 + pw / 2 - 3 * u;
    text(g, r.label, x0, y, 3.6 * u, on ? '#fff' : '#cfcfd4', { italic: true });
    if (r.bar !== undefined) {
      const bw = 20 * u;
      g.fillStyle = 'rgba(255,255,255,0.2)';
      g.fillRect(x1 - bw - 9 * u, y - u, bw, 2 * u);
      g.fillStyle = on ? '#ffd23f' : '#fff';
      g.fillRect(x1 - bw - 9 * u, y - u, bw * r.bar, 2 * u);
    }
    if (r.value)
      text(g, r.value, x1, y, 3 * u, on ? '#ffd23f' : '#fff', { align: 'right', weight: 700 });
  });
}

function bar(
  g: CanvasRenderingContext2D,
  label: string,
  v: number,
  x: number,
  y: number,
  u: number,
): void {
  text(g, label, x, y, 2.6 * u, '#fff', { weight: 700 });
  g.fillStyle = 'rgba(255,255,255,0.2)';
  g.fillRect(x + 14 * u, y - u, 24 * u, 2 * u);
  g.fillStyle = '#ffd23f';
  g.fillRect(x + 14 * u, y - u, 24 * u * (0.08 + 0.92 * v), 2 * u);
}

function drawGarage(
  g: CanvasRenderingContext2D,
  m: NonNullable<NonNullable<HudView['menu']>['garage']>,
  w: number,
  h: number,
  u: number,
): void {
  g.fillStyle = 'rgba(4,6,14,0.82)';
  g.fillRect(0, 0, w, h);
  const cx = w / 2;
  const cy = h * 0.42;
  // turntable glow
  g.save();
  g.translate(cx, cy);
  g.scale(1, 0.55);
  const glow = g.createRadialGradient(0, 0, 2 * u, 0, 0, 36 * u);
  glow.addColorStop(0, 'rgba(255,230,160,0.55)');
  glow.addColorStop(0.5, 'rgba(255,170,60,0.18)');
  glow.addColorStop(1, 'rgba(255,170,60,0)');
  g.fillStyle = glow;
  g.beginPath();
  g.arc(0, 0, 36 * u, 0, Math.PI * 2);
  g.fill();
  g.restore();
  // car, slowly rotating
  g.save();
  g.translate(cx, cy);
  g.rotate((performance.now() / 1000) * 0.5);
  g.scale(13 * u, 13 * u);
  drawCar(g, m.model, m.color);
  g.restore();

  text(g, m.name.toUpperCase(), cx, h * 0.12, 8 * u, '#fff', {
    align: 'center',
    italic: true,
    weight: 900,
    stroke: '#e8262b',
  });
  text(g, `◀  ${m.index + 1} / ${m.count}  ▶`, cx, h * 0.12 + 7 * u, 2.8 * u, '#ffd23f', {
    align: 'center',
  });
  // paint swatches
  const sw = 4 * u;
  m.colors.forEach((c, i) => {
    const x = cx + (i - (m.colors.length - 1) / 2) * (sw + u);
    g.fillStyle = c;
    g.fillRect(x - sw / 2, h * 0.72, sw, sw);
    if (c === m.color) {
      g.strokeStyle = '#ffd23f';
      g.lineWidth = 0.5 * u;
      g.strokeRect(x - sw / 2 - u * 0.5, h * 0.72 - u * 0.5, sw + u, sw + u);
    }
  });
  const sx = cx - 19 * u;
  bar(g, 'POWER', m.stats.power, sx, h * 0.8, u);
  bar(g, 'GRIP', m.stats.grip, sx, h * 0.8 + 4 * u, u);
  bar(g, 'WEIGHT', m.stats.weight, sx, h * 0.8 + 8 * u, u);
  hints(g, '←/→ car · ↑/↓ paint · ENTER select · ESC back', w, h, u);
}

/** Draws title / garage / settings; returns false when no menu is active. */
export function drawMenu(
  ctx: CanvasRenderingContext2D,
  v: HudView,
  width: number,
  height: number,
): boolean {
  const m = v.menu;
  if (!m) return false;
  const u = Math.min(width, height) / 100;
  const cx = width / 2;
  if (m.screen === 'garage') {
    if (m.garage) drawGarage(ctx, m.garage, width, height, u);
    return true;
  }
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, 0, width, height);
  if (m.screen === 'title') {
    text(ctx, 'DRIFTA', cx, height * 0.2, 18 * u, '#e8262b', {
      align: 'center',
      italic: true,
      weight: 900,
      stroke: '#fff',
    });
    text(ctx, 'Drift. Chain. Bank.', cx, height * 0.2 + 12 * u, 4 * u, '#fff', {
      align: 'center',
      italic: true,
    });
    rows(ctx, m.rows, m.row, width, height * 0.5, u);
    if (v.par > 0)
      text(
        ctx,
        `BEST ${Math.round(v.best).toLocaleString('en-US')}`,
        cx,
        height * 0.5 + 36 * u,
        3 * u,
        '#fff',
        {
          align: 'center',
        },
      );
    hints(
      ctx,
      '↑/↓ move · ←/→ map · ENTER select · WASD drive · SPACE handbrake · ESC pause',
      width,
      height,
      u,
    );
  } else {
    text(ctx, 'SETTINGS', cx, height * 0.14, 9 * u, '#fff', {
      align: 'center',
      italic: true,
      weight: 900,
      stroke: '#e8262b',
    });
    rows(ctx, m.rows, m.row, width, height * 0.28, u);
    hints(ctx, '↑/↓ move · ←/→ change · ENTER select · ESC back', width, height, u);
  }
  return true;
}
