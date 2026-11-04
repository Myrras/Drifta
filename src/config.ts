export const PHYSICS_HZ = 60;
export const DT = 1 / PHYSICS_HZ;
export const DRIFT_MIN_SLIP_DEG = 15;
export const DRIFT_MIN_SPEED_KMH = 30;
export const COMBO_GRACE = 1.5; // s between drifts before the combo banks
export const DRIFT_POINT_SCALE = 0.2; // points/s = slipDeg * speedKmh * scale
export const CLOSE_CALL_DIST = 1.0; // m from any solid while drifting
export const CLOSE_CALL_COOLDOWN = 1.0; // s
export const CLOSE_CALL_BONUS = 250;
export const SWITCHBACK_BONUS = 500;
export const LONG_DRIFT_BONUS = 300;
export const LONG_DRIFT_INTERVAL = 2; // s of unbroken drift
export const SPIN_BONUS = 1000; // per full 360 within a combo
export const RAMP_DRIFT_BONUS = 750;
export const CLIP_RATE = 2; // drift points multiplier inside a clipping zone
export const CLIP_BONUS = 200; // first entry per zone per combo
export const COUNTDOWN_SECONDS = 3;
export const BEST_SCORE_KEY = 'drifta.best';
