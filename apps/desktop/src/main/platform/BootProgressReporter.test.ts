import { describe, expect, it, vi } from "vitest";

import { BootProgressReporter } from "./BootProgressReporter.js";

const noopLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never;

describe("BootProgressReporter", () => {
	it("starts in 'initializing' phase with a default message", () => {
		const reporter = new BootProgressReporter(noopLogger);
		expect(reporter.phase).toBe("initializing");
		expect(reporter.message).toBe("Starting…");
	});

	it("report() updates phase and message", () => {
		const reporter = new BootProgressReporter(noopLogger);
		reporter.report("updates", "Checking for updates…");
		expect(reporter.phase).toBe("updates");
		expect(reporter.message).toBe("Checking for updates…");
	});

	it("notifies listeners on report()", () => {
		const reporter = new BootProgressReporter(noopLogger);
		const listener = vi.fn();
		reporter.onProgress(listener);

		reporter.report("features", "Preparing features…");

		expect(listener).toHaveBeenCalledOnce();
		expect(listener).toHaveBeenCalledWith({
			phase: "features",
			message: "Preparing features…",
		});
	});

	it("unsubscribe removes the listener", () => {
		const reporter = new BootProgressReporter(noopLogger);
		const listener = vi.fn();
		const unsubscribe = reporter.onProgress(listener);

		unsubscribe();
		reporter.report("ready", "Ready");

		expect(listener).not.toHaveBeenCalled();
	});

	it("reportFeature() reports the features phase with a display name", () => {
		const reporter = new BootProgressReporter(noopLogger);
		const listener = vi.fn();
		reporter.onProgress(listener);

		reporter.reportFeature("todos");

		expect(reporter.phase).toBe("features");
		expect(reporter.message).toBe("Preparing todos…");
		expect(listener).toHaveBeenCalledWith({
			phase: "features",
			message: "Preparing todos…",
		});
	});

	it("complete() sets phase to ready", () => {
		const reporter = new BootProgressReporter(noopLogger);
		reporter.complete();
		expect(reporter.phase).toBe("ready");
		expect(reporter.message).toBe("Ready");
	});

	it("dispose() clears all listeners", () => {
		const reporter = new BootProgressReporter(noopLogger);
		const listener = vi.fn();
		reporter.onProgress(listener);

		reporter.dispose();
		reporter.report("features", "Should not notify");

		expect(listener).not.toHaveBeenCalled();
	});

	it("supports multiple listeners simultaneously", () => {
		const reporter = new BootProgressReporter(noopLogger);
		const listener1 = vi.fn();
		const listener2 = vi.fn();
		reporter.onProgress(listener1);
		reporter.onProgress(listener2);

		reporter.report("updates", "Checking…");

		expect(listener1).toHaveBeenCalledOnce();
		expect(listener2).toHaveBeenCalledOnce();
	});

	it("logs each phase transition", () => {
		const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never;
		const reporter = new BootProgressReporter(logger);

		reporter.report("updates", "Checking for updates…");

		expect((logger as { info: ReturnType<typeof vi.fn> }).info).toHaveBeenCalledWith(
			"[updates] Checking for updates…",
		);
	});

	it("isolates listener errors — a throwing listener does not abort later listeners", () => {
		const reporter = new BootProgressReporter(noopLogger);
		const badListener = vi.fn(() => {
			throw new Error("listener failure");
		});
		const goodListener = vi.fn();
		reporter.onProgress(badListener);
		reporter.onProgress(goodListener);

		reporter.report("features", "Preparing…");

		expect(badListener).toHaveBeenCalledOnce();
		expect(goodListener).toHaveBeenCalledOnce();
	});
});
