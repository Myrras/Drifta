import type { CarModel } from './types';
import { CAR_MODELS } from './models';

/** Draws a parked car centered at the origin, nose toward +x, 1 unit = 1 m (caller sets the transform). */
export function drawParkedCar(ctx: CanvasRenderingContext2D, model: CarModel, color: string): void {
  const { length, width } = CAR_MODELS[model];
  ctx.fillStyle = color;
  ctx.fillRect(-length / 2, -width / 2, length, width);
}
