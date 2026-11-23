/**
 * Coarse buckets for Reading Mode telemetry: counts, lengths and ages are
 * never sent as exact values.
 */
export type CountBucket = "0" | "1" | "2-5" | "6-20" | "21+";
export type LengthBucket = "0" | "1-20" | "21-100" | "101-500" | "501+";
export type AgeBucket = "<1h" | "<1d" | "<7d" | "<30d" | "30d+";
export type DurationBucket = "<10s" | "<1m" | "<5m" | "<20m" | "20m+";

export function countBucket(count: number): CountBucket {
	if (count <= 0) return "0";
	if (count === 1) return "1";
	if (count <= 5) return "2-5";
	if (count <= 20) return "6-20";
	return "21+";
}

export function lengthBucket(length: number): LengthBucket {
	if (length <= 0) return "0";
	if (length <= 20) return "1-20";
	if (length <= 100) return "21-100";
	if (length <= 500) return "101-500";
	return "501+";
}

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

export function ageBucket(ms: number): AgeBucket {
	if (ms < HOUR) return "<1h";
	if (ms < DAY) return "<1d";
	if (ms < 7 * DAY) return "<7d";
	if (ms < 30 * DAY) return "<30d";
	return "30d+";
}

export function durationBucket(seconds: number): DurationBucket {
	if (seconds < 10) return "<10s";
	if (seconds < 60) return "<1m";
	if (seconds < 300) return "<5m";
	if (seconds < 1200) return "<20m";
	return "20m+";
}

/** Whole days since `at`, or null when never; capped so outliers stay coarse. */
export function daysSince(at: number | null, now: number): number | null {
	if (at === null) return null;
	return Math.min(365, Math.max(0, Math.floor((now - at) / DAY)));
}

/** A percentage rounded to tens. */
export function roundToTen(value: number): number {
	return Math.round(value / 10) * 10;
}
