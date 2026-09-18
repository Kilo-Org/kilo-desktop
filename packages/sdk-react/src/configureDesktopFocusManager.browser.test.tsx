import { beforeEach, describe, expect, it, vi } from "vitest";

import { focusManager } from "@tanstack/react-query";

import { configureDesktopFocusManager } from "./configureDesktopFocusManager.js";

// Boolean notifications make the focusManager's _focused state persist across
// tests in this file, so each test resets it to the visibilityState fallback.
describe("configureDesktopFocusManager", () => {
	beforeEach(() => {
		configureDesktopFocusManager();
		focusManager.setFocused(undefined);
	});

	it("notifies focusManager subscribers on the window focus event", () => {
		const onFocus = vi.fn();
		const unsubscribe = focusManager.subscribe(onFocus);

		window.dispatchEvent(new Event("focus"));

		expect(onFocus).toHaveBeenCalledWith(true);
		unsubscribe();
	});

	it("notifies focusManager subscribers when the window becomes visible again", () => {
		const onFocus = vi.fn();
		const unsubscribe = focusManager.subscribe(onFocus);

		window.dispatchEvent(new Event("visibilitychange"));

		expect(onFocus).toHaveBeenCalledWith(true);
		unsubscribe();
	});

	it("notifies focusManager subscribers with false on window blur", () => {
		// Start focused so the transition from true → false fires.
		focusManager.setFocused(true);
		const onFocus = vi.fn();
		const unsubscribe = focusManager.subscribe(onFocus);

		window.dispatchEvent(new Event("blur"));

		expect(onFocus).toHaveBeenCalledWith(false);
		unsubscribe();
	});

	it("notifies focusManager with false when the page becomes hidden", () => {
		// Start focused so the transition from true → false fires.
		focusManager.setFocused(true);
		const originalDescriptor = Object.getOwnPropertyDescriptor(document, "visibilityState");
		Object.defineProperty(document, "visibilityState", {
			value: "hidden",
			configurable: true,
		});
		const onFocus = vi.fn();
		const unsubscribe = focusManager.subscribe(onFocus);

		window.dispatchEvent(new Event("visibilitychange"));

		expect(onFocus).toHaveBeenCalledWith(false);
		unsubscribe();
		if (originalDescriptor) {
			Object.defineProperty(document, "visibilityState", originalDescriptor);
		}
	});

	it("deduplicates consecutive focus events — subscribers notified exactly once", () => {
		// Start unfocused so the first focus fires a notification.
		focusManager.setFocused(false);
		const onFocus = vi.fn();
		const unsubscribe = focusManager.subscribe(onFocus);

		window.dispatchEvent(new Event("focus"));
		window.dispatchEvent(new Event("focus"));

		expect(onFocus).toHaveBeenCalledTimes(1);
		expect(onFocus).toHaveBeenCalledWith(true);
		unsubscribe();
	});
});
