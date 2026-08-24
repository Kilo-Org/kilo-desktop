import { describe, expect, it, vi } from "vitest";

import { AwaitedShutdownBarrier } from "./AwaitedShutdownBarrier.js";

function deferred(): { promise: Promise<void>; resolve: () => void } {
	let resolve!: () => void;
	const promise = new Promise<void>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

const silentLogger = { error: () => undefined };

describe("AwaitedShutdownBarrier", () => {
	it("prevents quit until asynchronous cleanup settles", async () => {
		const cleanup = deferred();
		const dispose = vi.fn(() => cleanup.promise);
		const quit = vi.fn();
		const event = { preventDefault: vi.fn() };
		const barrier = new AwaitedShutdownBarrier({ dispose, quit, logger: silentLogger });

		const shutdown = barrier.handleBeforeQuit(event);
		expect(event.preventDefault).toHaveBeenCalledOnce();
		expect(quit).not.toHaveBeenCalled();
		cleanup.resolve();
		await shutdown;
		expect(dispose).toHaveBeenCalledOnce();
		expect(quit).toHaveBeenCalledOnce();
	});

	it("shares cleanup and lets its final quit pass through", async () => {
		const cleanup = deferred();
		const dispose = vi.fn(() => cleanup.promise);
		const quit = vi.fn();
		const barrier = new AwaitedShutdownBarrier({ dispose, quit, logger: silentLogger });
		const firstEvent = { preventDefault: vi.fn() };
		const repeatedEvent = { preventDefault: vi.fn() };

		const first = barrier.handleBeforeQuit(firstEvent);
		expect(barrier.handleBeforeQuit(repeatedEvent)).toBe(first);
		cleanup.resolve();
		await first;
		const finalEvent = { preventDefault: vi.fn() };
		expect(barrier.handleBeforeQuit(finalEvent)).toBeUndefined();
		expect(finalEvent.preventDefault).not.toHaveBeenCalled();
		expect(dispose).toHaveBeenCalledOnce();
	});

	it("allows quit after cleanup fails", async () => {
		const quit = vi.fn();
		const barrier = new AwaitedShutdownBarrier({
			dispose: async () => Promise.reject(new Error("failed")),
			quit,
			logger: silentLogger,
		});
		await barrier.handleBeforeQuit({ preventDefault: vi.fn() });
		expect(quit).toHaveBeenCalledOnce();
	});
});
