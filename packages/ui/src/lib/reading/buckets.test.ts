import { describe, expect, it } from "vitest";

import {
	ageBucket,
	countBucket,
	daysSince,
	durationBucket,
	lengthBucket,
	roundToTen,
} from "./buckets";

describe("telemetry buckets", () => {
	it("buckets counts and lengths", () => {
		expect([0, 1, 2, 5, 6, 20, 21].map(countBucket)).toEqual([
			"0",
			"1",
			"2-5",
			"2-5",
			"6-20",
			"6-20",
			"21+",
		]);
		expect([0, 20, 21, 100, 101, 500, 501].map(lengthBucket)).toEqual([
			"0",
			"1-20",
			"21-100",
			"21-100",
			"101-500",
			"101-500",
			"501+",
		]);
	});

	it("buckets ages and durations", () => {
		const hour = 3_600_000;
		expect([0, hour, 24 * hour, 7 * 24 * hour, 30 * 24 * hour].map(ageBucket)).toEqual([
			"<1h",
			"<1d",
			"<7d",
			"<30d",
			"30d+",
		]);
		expect([5, 30, 120, 600, 3000].map(durationBucket)).toEqual([
			"<10s",
			"<1m",
			"<5m",
			"<20m",
			"20m+",
		]);
	});

	it("counts whole days since a time, and rounds to tens", () => {
		expect(daysSince(null, 0)).toBeNull();
		expect(daysSince(0, 2.5 * 86_400_000)).toBe(2);
		expect(daysSince(0, 900 * 86_400_000)).toBe(365);
		expect(roundToTen(64)).toBe(60);
		expect(roundToTen(65)).toBe(70);
	});
});
