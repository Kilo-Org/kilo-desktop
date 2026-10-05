import { afterEach, describe, expect, it, vi } from "vitest";

import { acquireBrowserGuest } from "./browser-guest-lease.js";

function hostFor(instanceId: string): HTMLElement | null {
	return document.querySelector<HTMLElement>(`[data-browser-webview-host="${instanceId}"]`);
}

describe("acquireBrowserGuest", () => {
	afterEach(() => {
		vi.useRealTimers();
		for (const host of document.querySelectorAll("[data-browser-webview-host]"))
			Element.prototype.remove.call(host);
	});

	it("tears down the guest host after the release delay", () => {
		vi.useFakeTimers();
		const lease = acquireBrowserGuest("release-1", "persist:test", "about:blank");
		expect(hostFor("release-1")).not.toBeNull();

		lease.release();
		vi.advanceTimersByTime(1_000);

		expect(hostFor("release-1")).toBeNull();
	});

	it("keeps the guest alive until the last reference is released", () => {
		vi.useFakeTimers();
		const first = acquireBrowserGuest("ref-1", "persist:test", "about:blank");
		const second = acquireBrowserGuest("ref-1", "persist:test", "about:blank");

		first.release();
		vi.advanceTimersByTime(1_000);
		expect(hostFor("ref-1")).not.toBeNull();

		second.release();
		vi.advanceTimersByTime(1_000);
		expect(hostFor("ref-1")).toBeNull();
	});

	it("swallows Electron's teardown error when the guest host is already destroyed", () => {
		vi.useFakeTimers();
		const lease = acquireBrowserGuest("destroyed-1", "persist:test", "about:blank");
		const host = hostFor("destroyed-1");
		expect(host).not.toBeNull();

		// Electron's <webview> disconnectedCallback throws `Invalid guestInstanceId`
		// when the guest's webContents was already torn down before removal.
		host!.remove = () => {
			throw new Error("Invalid guestInstanceId: 4");
		};

		lease.release();

		expect(() => vi.advanceTimersByTime(1_000)).not.toThrow();
	});
});
