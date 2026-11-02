import { COMBO_GRACE } from './config';
import type { HudView } from './view';

const FONT = '"Segoe UI", system-ui, sans-serif';

export function formatTime(seconds: number): string {
  const cs = Math.floor(Math.max(0, seconds) * 100 + 1e-6);
  const m = Math.floor(cs / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${m}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}

export function formatScore(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function comboString(tricks: string[]): string {
  const groups: string[] = [];
  for (let i = 0; i < tricks.length;) {
    let j = i;
    while (j < tricks.length && tricks[j] === tricks[i]) j++;
    groups.push(j - i > 1 ? `${tricks[i]} ×${j - i}` : tricks[i]);
    i = j;
  }
  if (groups.length > 6) return '… + ' + groups.slice(-6).join(' + ');
  return groups.join(' + ');
}

interface TextOpts {
  align?: CanvasTextAlign;
  weight?: number;
  italic?: boolean;
  stroke?: string;
  alpha?: number;
}

function text(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  size: number,
  fill: string,
  opts: TextOpts = {},
): void {
  ctx.save();
  ctx.globalAlpha = opts.alpha ?? 1;
  ctx.font = `${opts.italic ? 'italic ' : ''}${opts.weight ?? 800} ${size}px ${FONT}`;
  ctx.textAlign = opts.align ?? 'left';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2, size * 0.16);
  ctx.strokeStyle = opts.stroke ?? 'rgba(0,0,0,0.75)';
  ctx.strokeText(s, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(s, x, y);
  ctx.restore();
}

function overlay(ctx: CanvasRenderingContext2D, w: number, h: number, a: number): void {
  ctx.fillStyle = `rgba(0,0,0,${a})`;
  ctx.fillRect(0, 0, w, h);
}

export function drawHud(
  ctx: CanvasRenderingContext2D,
  v: HudView,
  width: number,
  height: number,
): void {
  const u = Math.min(width, height) / 100; // 1 unit = 1% of short side
  const now = performance.now() / 1000;
  const cx = width / 2;
  const pad = 3 * u;

  if (v.phase === 'title') {
    overlay(ctx, width, height, 0.6);
    text(ctx, 'DRIFTA', cx, height * 0.25, 18 * u, '#e8262b', {
      align: 'center',
      italic: true,
      weight: 900,
      stroke: '#fff',
    });
    text(ctx, 'Drift. Chain. Bank.', cx, height * 0.25 + 12 * u, 4 * u, '#fff', {
      align: 'center',
      italic: true,
    });
    // Translucent band behind the prompt so it reads over the car; pulse floored at 70%.
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, height * 0.5 - 4 * u, width, 8 * u);
    ctx.restore();
    text(ctx, 'Press ENTER / A to start', cx, height * 0.5, 4.5 * u, '#ffd23f', {
      align: 'center',
      stroke: '#000',
      alpha: 0.85 + 0.15 * Math.sin(now * 5),
    });
    [
      'WASD/Arrows drive · SPACE handbrake · R restart · ESC pause',
      'Gamepad: stick, RT/LT, A handbrake, START pause',
    ].forEach((l, i) =>
      text(ctx, l, cx, height * 0.62 + i * 4 * u, 2.6 * u, '#ddd', {
        align: 'center',
        weight: 700,
      }),
    );
    text(ctx, `BEST ${formatScore(v.best)}`, cx, height * 0.62 + 12 * u, 3.4 * u, '#fff', {
      align: 'center',
    });
    return;
  }

  if (v.phase === 'run' || v.phase === 'paused') {
    text(ctx, formatTime(v.time), pad, pad + 3 * u, 5 * u, v.time > v.par ? '#ff4444' : '#fff');
    text(ctx, `PAR ${formatTime(v.par)}`, pad, pad + 8 * u, 2.6 * u, '#ddd', { weight: 700 });
    text(ctx, v.floorName, cx, pad + 3 * u, 3.4 * u, '#fff', { align: 'center' });
    text(ctx, formatScore(v.score), width - pad, pad + 3 * u, 5 * u, '#fff', { align: 'right' });
    text(ctx, `BEST ${formatScore(v.best)}`, width - pad, pad + 8 * u, 2.6 * u, '#ddd', {
      align: 'right',
      weight: 700,
    });

    const baseY = height - 16 * u;
    const c = v.combo;
    if (c) {
      text(ctx, comboString(c.tricks), cx, baseY, 3.6 * u, '#ffd23f', {
        align: 'center',
        italic: true,
        weight: 900,
      });
      text(ctx, `×${c.multiplier}`, cx - 2 * u, baseY + 6 * u, 6 * u, '#fff', {
        align: 'right',
        italic: true,
        weight: 900,
      });
      text(ctx, formatScore(v.comboValue), cx + 2 * u, baseY + 6 * u, 5 * u, '#ffd23f', {
        italic: true,
      });
      const bw = 24 * u;
      const g = Math.max(0, Math.min(1, c.grace / COMBO_GRACE));
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(cx - bw / 2, baseY + 11 * u, bw, u);
      ctx.fillStyle = '#ffd23f';
      ctx.fillRect(cx - bw / 2, baseY + 11 * u, bw * g, u);
    }

    // popups are appended oldest-first; keep the 5 newest, newest in slot 0 (bottom).
    const live = v.popups.slice(-5);
    const slotH = 1.2 * 5 * u; // one line at the largest popup font
    live.forEach((p, i) => {
      const t = p.age / 1.5;
      const y = baseY - 6 * u - (live.length - 1 - i) * slotH - t * 12 * u;
      const alpha = Math.max(0, 1 - t * t);
      if (p.kind === 'trick') {
        text(ctx, p.text, cx, y, 3.4 * u, '#ffd23f', { align: 'center', italic: true, alpha });
      } else if (p.kind === 'bank') {
        text(ctx, `+${formatScore(p.amount)}`, cx, y, 5 * u, '#4cff7a', {
          align: 'center',
          italic: true,
          alpha,
        });
      } else {
        // BAILED and its amount both sit inside this slot (about ±3u around y).
        text(ctx, 'BAILED', cx, y - 1.6 * u, 5 * u, '#ff4444', {
          align: 'center',
          italic: true,
          alpha,
        });
        text(ctx, `-${formatScore(p.amount)}`, cx, y + 1.9 * u, 3.4 * u, '#ff8888', {
          align: 'center',
          alpha,
        });
      }
    });

    const r = 9 * u;
    const sx = width - pad - r - u;
    const sy = height - pad - r - u;
    const a0 = Math.PI * 0.667; // 240 deg arc, gap at the bottom
    const sweep = (Math.PI * 4) / 3;
    const f = Math.max(0, Math.min(1, v.speedKmh / 140));
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = 1.6 * u;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.beginPath();
    ctx.arc(sx, sy, r, a0, a0 + sweep);
    ctx.stroke();
    if (f > 0) {
      ctx.strokeStyle = f > 0.85 ? '#ff5544' : '#ffd23f';
      ctx.beginPath();
      ctx.arc(sx, sy, r, a0, a0 + sweep * f);
      ctx.stroke();
    }
    ctx.restore();
    text(ctx, String(Math.round(v.speedKmh)), sx, sy - u, 5 * u, '#fff', { align: 'center' });
    text(ctx, 'KM/H', sx, sy + 3.6 * u, 2 * u, '#ddd', { align: 'center', weight: 700 });

    if (v.phase === 'run' && v.time < 0.7) {
      text(ctx, 'GO!', cx, height * 0.4, 16 * u * (1 + (0.7 - v.time) * 0.3), '#4cff7a', {
        align: 'center',
        italic: true,
        weight: 900,
        alpha: Math.min(1, (0.7 - v.time) * 4),
      });
    }
    if (v.phase === 'paused') {
      overlay(ctx, width, height, 0.55);
      text(ctx, 'PAUSED', cx, height * 0.45, 12 * u, '#fff', { align: 'center', weight: 900 });
      text(ctx, 'ESC / START resume · R restart', cx, height * 0.55, 3 * u, '#ddd', {
        align: 'center',
        weight: 700,
      });
    }
    return;
  }

  if (v.phase === 'countdown') {
    const k = 1 + (v.countdown - Math.floor(v.countdown)) * 0.5;
    text(ctx, String(Math.ceil(v.countdown)), cx, height * 0.45, 24 * u * k, '#fff', {
      align: 'center',
      italic: true,
      weight: 900,
    });
    return;
  }

  const r = v.results;
  if (!r) return;
  overlay(ctx, width, height, 0.7);
  const pw = Math.min(width * 0.9, 60 * u);
  const top = height / 2 - 28 * u;
  ctx.fillStyle = 'rgba(20,20,28,0.9)';
  ctx.fillRect(cx - pw / 2, top, pw, 56 * u);
  text(ctx, 'FINISHED', cx, top + 6 * u, 7 * u, '#fff', {
    align: 'center',
    italic: true,
    weight: 900,
  });
  const rows: [string, string][] = [
    ['Combo points', formatScore(r.comboPoints)],
    ['Time', formatTime(r.time)],
    ['Time bonus', formatScore(r.timeBonus)],
  ];
  rows.forEach(([k, val], i) => {
    const y = top + (14 + i * 5) * u;
    text(ctx, k, cx - pw / 2 + 4 * u, y, 3 * u, '#ccc', { weight: 700 });
    text(ctx, val, cx + pw / 2 - 4 * u, y, 3 * u, '#fff', { align: 'right' });
  });
  text(ctx, 'Total', cx - pw / 2 + 4 * u, top + 33 * u, 4 * u, '#ffd23f');
  text(ctx, formatScore(r.total), cx + pw / 2 - 4 * u, top + 33 * u, 7 * u, '#ffd23f', {
    align: 'right',
    italic: true,
    weight: 900,
  });
  text(ctx, `Best ${formatScore(r.best)}`, cx, top + 41 * u, 3 * u, '#ddd', {
    align: 'center',
    weight: 700,
  });
  if (r.newBest && Math.floor(now * 3) % 2 === 0)
    text(ctx, 'NEW BEST!', cx, top + 47 * u, 4.5 * u, '#4cff7a', { align: 'center', italic: true });
  text(ctx, 'ENTER / A race again', cx, top + 53 * u, 2.8 * u, '#fff', {
    align: 'center',
    weight: 700,
  });
}
