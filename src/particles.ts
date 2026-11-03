/** Pooled world-space particles: tire smoke (lit by the darkness pass) and sparks (emissive). */

type Ctx = CanvasRenderingContext2D;

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  /** smoke: start radius (m) */
  size: number;
  /** smoke: peak opacity */
  alpha: number;
  /** smoke: velocity swirl (rad/s) */
  spin: number;
  /** smoke: sprite variant */
  kind: number;
}

/** Fixed-size ring pool: spawning overwrites the oldest slot, nothing is allocated per frame. */
export function createPool(cap: number) {
  const items: Particle[] = Array.from({ length: cap }, () => ({
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    age: Infinity,
    life: 0,
    size: 0,
    alpha: 0,
    spin: 0,
    kind: 0,
  }));
  let next = 0;
  return {
    items,
    spawn(x: number, y: number, vx: number, vy: number, life: number): Particle {
      const p = items[next];
      next = (next + 1) % cap;
      Object.assign(p, { x, y, vx, vy, life, age: 0 });
      return p;
    },
    clear() {
      for (const p of items) p.age = Infinity;
    },
  };
}
export type Pool = ReturnType<typeof createPool>;

const SMOKE_RGB = '214,214,220';
const SMOKE_DRAG = 1.8; // 1/s
const SMOKE_GROW = 3; // radius grows to size * (1 + GROW)
const WIND = { x: 0.35, y: -0.2 }; // m/s slow drift

/** Lumpy soft puffs (a few overlapping blobs), drawn once. */
export function puffSprites(n = 3): HTMLCanvasElement[] {
  let seed = 99;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  return Array.from({ length: n }, () => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    for (let i = 0; i < 6; i++) {
      const a = rand() * Math.PI * 2;
      const d = i === 0 ? 0 : 12 + rand() * 18;
      const x = 64 + Math.cos(a) * d;
      const y = 64 + Math.sin(a) * d;
      const r = i === 0 ? 60 : 26 + rand() * 18;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, `rgba(${SMOKE_RGB},${i === 0 ? 0.75 : 0.45})`);
      grad.addColorStop(0.55, `rgba(${SMOKE_RGB},${i === 0 ? 0.35 : 0.2})`);
      grad.addColorStop(1, `rgba(${SMOKE_RGB},0)`);
      g.fillStyle = grad;
      g.fillRect(0, 0, 128, 128);
    }
    return c;
  });
}

export function updateSmoke(pool: Pool, step: number) {
  const drag = Math.exp(-SMOKE_DRAG * step);
  for (const p of pool.items) {
    if (p.age >= p.life) continue;
    p.age += step;
    const a = p.spin * step; // swirl: slowly turn the velocity
    const vx = p.vx * Math.cos(a) - p.vy * Math.sin(a);
    p.vy = (p.vx * Math.sin(a) + p.vy * Math.cos(a)) * drag;
    p.vx = vx * drag;
    p.x += (p.vx + WIND.x) * step;
    p.y += (p.vy + WIND.y) * step;
  }
}

export function drawSmoke(
  g: Ctx,
  pool: Pool,
  puffs: HTMLCanvasElement[],
  visible: (x: number, y: number, r: number) => boolean,
) {
  for (const p of pool.items) {
    if (p.age >= p.life) continue;
    const t = p.age / p.life;
    const r = p.size * (1 + SMOKE_GROW * (1 - (1 - t) ** 3)); // fast puff-out, then lazy
    if (!visible(p.x, p.y, r)) continue;
    g.globalAlpha = p.alpha * Math.min(1, t * 12) * (1 - t) ** 1.5;
    g.drawImage(puffs[p.kind], p.x - r, p.y - r, 2 * r, 2 * r);
  }
  g.globalAlpha = 1;
}

const SPARK_DRAG = 3.5;
const SPARK_BLUR = 0.045; // s of motion per streak
const SPARK_COLORS = ['rgba(255,246,200,1)', 'rgba(255,196,70,0.9)', 'rgba(255,120,30,0.6)'];

export function updateSparks(pool: Pool, step: number) {
  const drag = Math.exp(-SPARK_DRAG * step);
  for (const p of pool.items) {
    if (p.age >= p.life) continue;
    p.age += step;
    p.x += p.vx * step;
    p.y += p.vy * step;
    p.vx *= drag;
    p.vy *= drag;
  }
}

/** Additive motion streaks, white-hot to orange with age; one path per color band. */
export function drawSparks(
  g: Ctx,
  pool: Pool,
  visible: (x: number, y: number, r: number) => boolean,
) {
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.lineCap = 'round';
  g.lineWidth = 0.08;
  for (let band = 0; band < SPARK_COLORS.length; band++) {
    g.beginPath();
    for (const p of pool.items) {
      if (p.age >= p.life) continue;
      const t = p.age / p.life;
      if (Math.min(2, Math.floor(t * 3)) !== band || !visible(p.x, p.y, 1)) continue;
      g.moveTo(p.x, p.y);
      g.lineTo(p.x - p.vx * SPARK_BLUR - 0.02, p.y - p.vy * SPARK_BLUR);
    }
    g.strokeStyle = SPARK_COLORS[band];
    g.stroke();
  }
  g.restore();
}
