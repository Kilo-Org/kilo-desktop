import { describe, expect, it } from "vitest";

import { Throttler } from "./throttler.js";

/** VS Code's `async.timeout(0)`: a macrotask boundary, nothing more. */
function tick(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

// Ported from VS Code's `vs/base/test/common/async.test.ts`, suite
// `Throttler`, converting mocha/assert to vitest/expect and
// `async.timeout(0)` to a setTimeout promise.
describe("Throttler", () => {
	it("non async", async () => {
		let count = 0;
		const factory = () => Promise.resolve(++count);

		const throttler = new Throttler();

		await Promise.all([
			expect(throttler.queue(factory)).resolves.toBe(1),
			expect(throttler.queue(factory)).resolves.toBe(2),
			expect(throttler.queue(factory)).resolves.toBe(2),
			expect(throttler.queue(factory)).resolves.toBe(2),
			expect(throttler.queue(factory)).resolves.toBe(2),
		]);
		expect(count).toBe(2);
	});

	it("async", async () => {
		let count = 0;
		const factory = () => tick().then(() => ++count);

		const throttler = new Throttler();

		await Promise.all([
			expect(throttler.queue(factory)).resolves.toBe(1),
			expect(throttler.queue(factory)).resolves.toBe(2),
			expect(throttler.queue(factory)).resolves.toBe(2),
			expect(throttler.queue(factory)).resolves.toBe(2),
			expect(throttler.queue(factory)).resolves.toBe(2),
		]);
		await Promise.all([
			expect(throttler.queue(factory)).resolves.toBe(3),
			expect(throttler.queue(factory)).resolves.toBe(4),
			expect(throttler.queue(factory)).resolves.toBe(4),
			expect(throttler.queue(factory)).resolves.toBe(4),
			expect(throttler.queue(factory)).resolves.toBe(4),
		]);
	});

	it("last factory should be the one getting called", async () => {
		const factoryFactory = (n: number) => () => tick().then(() => n);

		const throttler = new Throttler();

		await Promise.all([
			expect(throttler.queue(factoryFactory(1))).resolves.toBe(1),
			expect(throttler.queue(factoryFactory(2))).resolves.toBe(3),
			expect(throttler.queue(factoryFactory(3))).resolves.toBe(3),
		]);
	});

	it("disposal after queueing", async () => {
		let factoryCalls = 0;
		const factory = () => {
			factoryCalls++;
			return tick();
		};

		const throttler = new Throttler();
		const promises: Promise<unknown>[] = [];

		promises.push(throttler.queue(factory));
		promises.push(throttler.queue(factory));
		throttler.dispose();

		await Promise.all(promises);
		expect(factoryCalls).toBe(1);
	});

	it("disposal before queueing", async () => {
		let factoryCalls = 0;
		const factory = () => {
			factoryCalls++;
			return tick();
		};

		const throttler = new Throttler();
		throttler.dispose();

		await expect(throttler.queue(factory)).rejects.toThrow("Throttler is disposed");
		expect(factoryCalls).toBe(0);
	});
});
