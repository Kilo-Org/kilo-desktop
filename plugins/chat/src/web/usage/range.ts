export function clamp(value: number, min: number, max: number) {
	if (Number.isNaN(value)) return min;
	return Math.min(max, Math.max(min, value));
}

/** `value` as a share of `total`, as a percentage in `0…100`. */
export function pct(value: number, total: number) {
	if (!(total > 0)) return 0;
	return clamp((value / total) * 100, 0, 100);
}

/**
 * A `0…100` share as it should be announced. `pct` divides, so a share that
 * reads as a whole number on screen can still reach `aria-valuenow` carrying
 * float error, which a screen reader reads out in full.
 */
export function announced(share: number) {
	return Math.round(share * 10) / 10;
}
