import { describe, expect, it } from "vitest";

import {
	chordFromKeyboardEvent,
	formatChord,
	parseChord,
	reservedChordAction,
	resolveKeybinding,
	serializeChord,
	type KeyboardEventLike,
} from "./keybindings.js";

function press(
	code: string,
	modifiers: Partial<Omit<KeyboardEventLike, "code">> = {},
): string | null {
	const chord = chordFromKeyboardEvent({
		code,
		metaKey: false,
		ctrlKey: false,
		altKey: false,
		shiftKey: false,
		...modifiers,
	});
	return chord ? serializeChord(chord) : null;
}

describe("resolveKeybinding", () => {
	it("maps Mod to ⌘ on macOS and Ctrl elsewhere, and picks per-platform variants", () => {
		const spec = { mac: "Mod+W", default: "Ctrl+Shift+W" };
		expect(serializeChord(resolveKeybinding(spec, "mac")!)).toBe("Meta+KeyW");
		expect(serializeChord(resolveKeybinding(spec, "windows")!)).toBe("Ctrl+Shift+KeyW");
		expect(serializeChord(resolveKeybinding("Mod+/", "linux")!)).toBe("Ctrl+Slash");
	});

	it("rejects unknown keys and modifiers, and specs without a variant for the platform", () => {
		expect(resolveKeybinding("Mod+Nope", "mac")).toBeNull();
		expect(resolveKeybinding("Hyper+K", "mac")).toBeNull();
		expect(resolveKeybinding({ mac: "Mod+K" }, "windows")).toBeNull();
	});
});

describe("chordFromKeyboardEvent", () => {
	it("ignores lone modifiers and unsupported keys", () => {
		expect(press("MetaLeft", { metaKey: true })).toBeNull();
		expect(press("MediaPlayPause")).toBeNull();
	});
});

describe("reservedChordAction", () => {
	it("reserves clipboard chords and every Windows-key chord off macOS, not app chords", () => {
		expect(reservedChordAction(parseChord("Meta+KeyV")!, "mac")).toBe("Paste");
		expect(reservedChordAction(parseChord("Meta+KeyE")!, "windows")).toBe("the system");
		expect(reservedChordAction(parseChord("Meta+KeyK")!, "mac")).toBeNull();
	});
});

describe("formatChord", () => {
	it("shows symbols on macOS and spelled-out keys elsewhere", () => {
		expect(formatChord(parseChord("Alt+Shift+Meta+KeyR")!, "mac")).toEqual(["⌥", "⇧", "⌘", "R"]);
		expect(formatChord(parseChord("Ctrl+Shift+PageDown")!, "windows")).toEqual([
			"Ctrl",
			"Shift",
			"PgDn",
		]);
	});
});
