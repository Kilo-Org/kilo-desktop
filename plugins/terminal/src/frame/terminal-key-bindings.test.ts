import { describe, expect, it } from "vitest";

import {
	terminalKeyAction,
	terminalKeyPlatformFrom,
	type TerminalKeyEventLike,
} from "./terminal-key-bindings.js";

function key(
	code: string,
	mods: Partial<Pick<TerminalKeyEventLike, "metaKey" | "ctrlKey" | "altKey" | "shiftKey">> = {},
	keyValue = code,
): TerminalKeyEventLike {
	return {
		key: keyValue,
		code,
		metaKey: false,
		ctrlKey: false,
		altKey: false,
		shiftKey: false,
		...mods,
	};
}

describe("terminalKeyAction on macOS", () => {
	// Expected bytes are Ghostty's "natural text editing" defaults from
	// src/config/Config.zig: super+left/right -> text \x01/\x05,
	// super+backspace -> text \x15, alt+left/right -> esc b / esc f.
	it.each([
		["Cmd+Left", key("ArrowLeft", { metaKey: true }), "\x01"],
		["Cmd+Right", key("ArrowRight", { metaKey: true }), "\x05"],
		["Cmd+Backspace", key("Backspace", { metaKey: true }), "\x15"],
		["Option+Left", key("ArrowLeft", { altKey: true }), "\x1bb"],
		["Option+Right", key("ArrowRight", { altKey: true }), "\x1bf"],
	])("sends the line-editing sequence for %s", (_label, event, data) => {
		expect(terminalKeyAction(event, "mac")).toEqual({ kind: "input", data });
	});

	// Config.zig macOS block: super+c copy, super+a select_all, super+k
	// clear_screen, super+home/end/page_up/page_down scroll the viewport.
	it.each([
		["Cmd+C", key("KeyC", { metaKey: true }, "c"), { kind: "copy" }],
		["Cmd+A", key("KeyA", { metaKey: true }, "a"), { kind: "select-all" }],
		["Cmd+K", key("KeyK", { metaKey: true }, "k"), { kind: "clear" }],
		["Cmd+Home", key("Home", { metaKey: true }), { kind: "scroll", to: "top" }],
		["Cmd+End", key("End", { metaKey: true }), { kind: "scroll", to: "bottom" }],
		["Cmd+PageUp", key("PageUp", { metaKey: true }), { kind: "scroll", to: "page-up" }],
		["Cmd+PageDown", key("PageDown", { metaKey: true }), { kind: "scroll", to: "page-down" }],
	])("maps %s to its terminal action", (_label, event, action) => {
		expect(terminalKeyAction(event, "mac")).toEqual(action);
	});

	it("matches letters by translated character, not physical key", () => {
		// Shift+Cmd+C is a different Ghostty chord; the uppercase key value must not match.
		expect(
			terminalKeyAction(key("KeyC", { metaKey: true, shiftKey: true }, "C"), "mac"),
		).toBeNull();
		// A non-US layout can put "c" on another physical key.
		expect(terminalKeyAction(key("KeyX", { metaKey: true }, "c"), "mac")).toEqual({ kind: "copy" });
	});

	it("leaves unbound chords to ghostty-web", () => {
		expect(terminalKeyAction(key("ArrowLeft"), "mac")).toBeNull();
		expect(
			terminalKeyAction(key("ArrowLeft", { metaKey: true, shiftKey: true }), "mac"),
		).toBeNull();
		expect(terminalKeyAction(key("ArrowLeft", { ctrlKey: true }), "mac")).toBeNull();
		expect(terminalKeyAction(key("KeyA", { ctrlKey: true }, "a"), "mac")).toBeNull();
	});
});

describe("terminalKeyAction on other platforms", () => {
	// Config.zig non-Darwin block: ctrl+shift+c copy (ctrl+c must stay SIGINT),
	// ctrl+shift+a select_all, shift+home/end/page_up/page_down scroll.
	it.each([
		["Ctrl+Shift+C", key("KeyC", { ctrlKey: true, shiftKey: true }, "C"), { kind: "copy" }],
		["Ctrl+Shift+A", key("KeyA", { ctrlKey: true, shiftKey: true }, "A"), { kind: "select-all" }],
		["Shift+Home", key("Home", { shiftKey: true }), { kind: "scroll", to: "top" }],
		["Shift+End", key("End", { shiftKey: true }), { kind: "scroll", to: "bottom" }],
		["Shift+PageUp", key("PageUp", { shiftKey: true }), { kind: "scroll", to: "page-up" }],
		["Shift+PageDown", key("PageDown", { shiftKey: true }), { kind: "scroll", to: "page-down" }],
	])("maps %s to its terminal action", (_label, event, action) => {
		expect(terminalKeyAction(event, "other")).toEqual(action);
	});

	it("does not apply the macOS table", () => {
		expect(terminalKeyAction(key("ArrowLeft", { metaKey: true }), "other")).toBeNull();
		expect(terminalKeyAction(key("KeyC", { ctrlKey: true }, "c"), "other")).toBeNull();
		expect(terminalKeyAction(key("KeyK", { metaKey: true }, "k"), "other")).toBeNull();
	});
});

describe("terminalKeyAction with application cursor keys (DECCKM)", () => {
	// ghostty-web hardcodes Home/End to CSI H / CSI F. Ghostty's encoder switches
	// them to SS3 (ESC O H / ESC O F) once a shell enters application mode, which
	// is what terminfo khome/kend advertise for xterm-256color.
	const application = { cursorKeysApplication: true };
	const normal = { cursorKeysApplication: false };

	it.each(["mac", "other"] as const)("sends SS3 Home/End on %s when the mode is on", (platform) => {
		expect(terminalKeyAction(key("Home"), platform, application)).toEqual({
			kind: "input",
			data: "\x1bOH",
		});
		expect(terminalKeyAction(key("End"), platform, application)).toEqual({
			kind: "input",
			data: "\x1bOF",
		});
	});

	it("leaves Home/End to ghostty-web in normal cursor mode", () => {
		expect(terminalKeyAction(key("Home"), "mac", normal)).toBeNull();
		expect(terminalKeyAction(key("End"), "mac", normal)).toBeNull();
	});

	it("does not rewrite modified Home/End", () => {
		expect(terminalKeyAction(key("Home", { shiftKey: true }), "mac", application)).toBeNull();
		expect(terminalKeyAction(key("End", { ctrlKey: true }), "other", application)).toBeNull();
	});

	it("still prefers the platform binding table", () => {
		expect(terminalKeyAction(key("Home", { metaKey: true }), "mac", application)).toEqual({
			kind: "scroll",
			to: "top",
		});
	});
});

describe("terminalKeyPlatformFrom", () => {
	it.each([
		["Chromium client hints", { userAgentData: { platform: "macOS" }, platform: "" }, "mac"],
		["legacy navigator.platform", { platform: "MacIntel" }, "mac"],
		["Windows", { userAgentData: { platform: "Windows" }, platform: "Win32" }, "other"],
		["Linux", { platform: "Linux x86_64" }, "other"],
		["nothing reported", {}, "other"],
	])("detects %s", (_label, navigatorLike, expected) => {
		expect(terminalKeyPlatformFrom(navigatorLike)).toBe(expected);
	});
});
