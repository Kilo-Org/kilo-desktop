import { describe, expect, it, vi } from "vitest";

import { singleFlight } from "./single-flight.js";

/** A promise plus its resolver, so a test can control when the run settles. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

describe("singleFlight", () => {
	it("shares one in-flight promise across concurrent calls", async () => {
		const gate = deferred<number>();
		const run = vi.fn(() => gate.promise);
		const wrapped = singleFlight(run);

		const a = wrapped();
		const b = wrapped();

		expect(run).toHaveBeenCalledTimes(1);
		expect(a).toBe(b);

		gate.resolve(42);
		await expect(a).resolves.toBe(42);
		await expect(b).resolves.toBe(42);
	});

	it("re-runs on a call made after the previous run settled", async () => {
		const run = vi
			.fn<() => Promise<string>>()
			.mockResolvedValueOnce("first")
			.mockResolvedValueOnce("second");
		const wrapped = singleFlight(run);

		await expect(wrapped()).resolves.toBe("first");
		await expect(wrapped()).resolves.toBe("second");
		expect(run).toHaveBeenCalledTimes(2);
	});

	it("forgets the in-flight promise after a rejection so a retry runs again", async () => {
		const run = vi
			.fn<() => Promise<string>>()
			.mockRejectedValueOnce(new Error("boom"))
			.mockResolvedValueOnce("recovered");
		const wrapped = singleFlight(run);

		await expect(wrapped()).rejects.toThrow("boom");
		await expect(wrapped()).resolves.toBe("recovered");
		expect(run).toHaveBeenCalledTimes(2);
	});
});
