import { describe, expect, it, vi } from "vitest";

// The default `createNotification` arrow calls `new Notification(...).show()`,
// so the mocked class must expose `show()` for the "default factory" test below.
vi.mock("electron", () => ({
	app: {},
	Notification: class {
		show() {}
	},
}));

import { ElectronNotifications } from "./ElectronNotifications.js";

import type { App } from "electron";

function makeNotifications(options?: {
	supported?: boolean;
	setBadgeCount?: (count: number) => boolean;
	create?: () => { show(): void };
}) {
	const shown: Array<{ title: string; body: string }> = [];
	const setBadgeCount = options?.setBadgeCount ?? vi.fn(() => true);
	const notifications = new ElectronNotifications(
		{ setBadgeCount } as unknown as App,
		() => options?.supported ?? true,
		options?.create ??
			((opts) => ({
				show: () => {
					shown.push(opts);
				},
			})),
	);
	return { notifications, shown, setBadgeCount };
}

describe("ElectronNotifications", () => {
	it("shows an OS notification and reports delivery", () => {
		const { notifications, shown } = makeNotifications();
		const result = notifications.show({ title: "Hi", message: "There", type: "info" });
		expect(result).toEqual({ delivered: true });
		expect(shown).toEqual([{ title: "Hi", body: "There" }]);
	});

	it("reports undelivered when OS notifications are unsupported", () => {
		const { notifications, shown } = makeNotifications({ supported: false });
		const result = notifications.show({ title: "Hi", message: "There", type: "info" });
		expect(result.delivered).toBe(false);
		expect(result.reason).toMatch(/not supported/);
		expect(shown).toEqual([]);
	});

	it("reports undelivered instead of throwing when show fails", () => {
		const { notifications } = makeNotifications({
			create: () => ({
				show: () => {
					throw new Error("boom");
				},
			}),
		});
		const result = notifications.show({ title: "Hi", message: "There", type: "error" });
		expect(result.delivered).toBe(false);
		expect(result.reason).toMatch(/could not be shown/);
	});

	it("sets the badge count and reports platform support honestly", () => {
		const { notifications, setBadgeCount } = makeNotifications();
		expect(notifications.setBadge(3)).toEqual({ delivered: true });
		expect(setBadgeCount).toHaveBeenCalledWith(3);

		const unsupported = makeNotifications({ setBadgeCount: () => false });
		const result = unsupported.notifications.setBadge(1);
		expect(result.delivered).toBe(false);
		expect(result.reason).toMatch(/not supported/);
	});

	it("defaults to Electron's Notification constructor when no factory is injected", () => {
		// Covers the default `createNotification` arrow: with no factory arg,
		// `show()` must fall back to `new Notification(options).show()` — the
		// mocked class above provides a no-op `show()` so this stays a pure
		// wiring test (no OS calls).
		const notifications = new ElectronNotifications(
			{ setBadgeCount: () => true } as unknown as App,
			() => true,
		);
		expect(notifications.show({ title: "T", message: "M", type: "info" })).toEqual({
			delivered: true,
		});
	});
});
