import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { themeChromeColors } from "@anaconda-agentic-desktop/contracts";

import { BootProgressReporter } from "./BootProgressReporter.js";

const fakeWindows = vi.hoisted(() => {
	interface FakeSplash {
		options: Record<string, unknown>;
		once: ReturnType<typeof vi.fn>;
		loadURL: ReturnType<typeof vi.fn>;
		show: ReturnType<typeof vi.fn>;
		destroy: ReturnType<typeof vi.fn>;
		isDestroyed: ReturnType<typeof vi.fn>;
		webContents: { executeJavaScript: ReturnType<typeof vi.fn> };
	}
	return { created: [] as FakeSplash[] };
});

vi.mock("electron", () => ({
	BrowserWindow: class {
		readonly once = vi.fn();
		readonly loadURL = vi.fn();
		readonly show = vi.fn();
		readonly destroy = vi.fn();
		readonly isDestroyed = vi.fn(() => false);
		readonly webContents = { executeJavaScript: vi.fn() };

		constructor(readonly options: Record<string, unknown>) {
			fakeWindows.created.push(this as unknown as (typeof fakeWindows.created)[number]);
		}
	},
	screen: {
		getPrimaryDisplay: () => ({
			workAreaSize: { width: 1920, height: 1080 },
		}),
	},
}));

const noopLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never;

import { SplashWindow } from "./SplashWindow.js";

describe("SplashWindow", () => {
	let reporter: BootProgressReporter;

	beforeEach(() => {
		reporter = new BootProgressReporter(noopLogger);
		fakeWindows.created.length = 0;
	});

	afterEach(() => {
		reporter.dispose();
		vi.clearAllMocks();
	});

	it("creates a frameless, non-resizable window with correct dimensions", () => {
		const splash = new SplashWindow(reporter, { isDark: false, logger: noopLogger });
		splash.show();

		expect(fakeWindows.created).toHaveLength(1);
		const opts = fakeWindows.created[0]!.options;
		expect(opts.frame).toBe(false);
		expect(opts.resizable).toBe(false);
		expect(opts.width).toBe(320);
		expect(opts.height).toBe(200);
		expect(opts.show).toBe(false);
		expect(opts.alwaysOnTop).toBe(true);
	});

	it("uses dark chrome colors when isDark is true", () => {
		const splash = new SplashWindow(reporter, { isDark: true, logger: noopLogger });
		splash.show();

		const opts = fakeWindows.created[0]!.options;
		expect(opts.backgroundColor).toBe(themeChromeColors.dark.background);
	});

	it("uses light chrome colors when isDark is false", () => {
		const splash = new SplashWindow(reporter, { isDark: false, logger: noopLogger });
		splash.show();

		const opts = fakeWindows.created[0]!.options;
		expect(opts.backgroundColor).toBe(themeChromeColors.light.background);
	});

	it("centers the window on the primary display", () => {
		const splash = new SplashWindow(reporter, { isDark: false, logger: noopLogger });
		splash.show();

		const opts = fakeWindows.created[0]!.options;
		// Screen: 1920x1080, Window: 320x200
		expect(opts.x).toBe(Math.round((1920 - 320) / 2));
		expect(opts.y).toBe(Math.round((1080 - 200) / 2));
	});

	it("is idempotent — calling show() twice creates only one window", () => {
		const splash = new SplashWindow(reporter, { isDark: false, logger: noopLogger });
		splash.show();
		splash.show();

		expect(fakeWindows.created).toHaveLength(1);
	});

	it("updates the status text when the reporter emits progress", () => {
		vi.useFakeTimers();
		const splash = new SplashWindow(reporter, { isDark: false, logger: noopLogger });
		splash.show();

		// Simulate ready-to-show and advance past SKIP_THRESHOLD_MS so the window is "visible"
		const readyToShow = fakeWindows.created[0]!.once.mock.calls.find(
			(call) => call[0] === "ready-to-show",
		)?.[1];
		readyToShow?.();
		vi.advanceTimersByTime(400);

		reporter.report("features", "Preparing todos…");

		expect(fakeWindows.created[0]!.webContents.executeJavaScript).toHaveBeenCalledWith(
			expect.stringContaining("Preparing todos"),
		);
		vi.useRealTimers();
	});

	it("close() destroys the window when it was never shown (fast boot skip)", async () => {
		vi.useFakeTimers();
		const splash = new SplashWindow(reporter, { isDark: false, logger: noopLogger });
		splash.show();

		// Trigger ready-to-show but DON'T advance timers past SKIP_THRESHOLD_MS
		const readyToShow = fakeWindows.created[0]!.once.mock.calls.find(
			(call) => call[0] === "ready-to-show",
		)?.[1];
		readyToShow?.();
		// Boot finishes before the show timer fires (under SKIP_THRESHOLD_MS)

		await splash.close();

		expect(fakeWindows.created[0]!.show).not.toHaveBeenCalled();
		expect(fakeWindows.created[0]!.destroy).toHaveBeenCalled();
		expect(splash.wasSkipped).toBe(true);
		vi.useRealTimers();
	});

	it("close() waits minimum display time when splash was shown", async () => {
		vi.useFakeTimers();
		const splash = new SplashWindow(reporter, { isDark: false, logger: noopLogger });
		splash.show();

		// Trigger ready-to-show and advance past SKIP_THRESHOLD_MS so it's shown
		const readyToShow = fakeWindows.created[0]!.once.mock.calls.find(
			(call) => call[0] === "ready-to-show",
		)?.[1];
		readyToShow?.();
		vi.advanceTimersByTime(400);
		expect(fakeWindows.created[0]!.show).toHaveBeenCalled();

		const closePromise = splash.close();
		// Should not be destroyed immediately (min display time)
		expect(fakeWindows.created[0]!.destroy).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(1000);
		await closePromise;

		expect(fakeWindows.created[0]!.destroy).toHaveBeenCalled();
		expect(splash.wasSkipped).toBe(false);
		vi.useRealTimers();
	});

	it("close() is idempotent — second call resolves immediately", async () => {
		const splash = new SplashWindow(reporter, { isDark: false, logger: noopLogger });
		splash.show();

		await splash.close();
		// Second call should not throw or hang
		await splash.close();
	});

	it("loads a data: URL with inline HTML containing the logo and status", () => {
		const splash = new SplashWindow(reporter, { isDark: false, logger: noopLogger });
		splash.show();

		const loadedUrl = fakeWindows.created[0]!.loadURL.mock.calls[0]?.[0] as string;
		expect(loadedUrl).toContain("data:text/html");
		const html = decodeURIComponent(loadedUrl.replace("data:text/html;charset=utf-8,", ""));
		expect(html).toContain('id="status"');
		expect(html).toContain("progress-bar");
		expect(html).toContain("svg");
		expect(html).toContain("Starting");
	});
});
