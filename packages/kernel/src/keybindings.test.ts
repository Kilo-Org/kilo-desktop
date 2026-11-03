import { describe, expect, it, vi } from "vitest";

import {
	chordFromKeyboardEvent,
	detectKeyboardPlatform,
	formatChord,
	hasCommandModifier,
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

describe("serializeChord and parseChord", () => {
	it("round-trip a chord in canonical modifier order", () => {
		const chord = resolveKeybinding("Shift+Alt+Ctrl+Meta+K", "linux")!;

		const serialized = serializeChord(chord);

		expect(serialized).toBe("Ctrl+Alt+Shift+Meta+KeyK");
		expect(parseChord(serialized)).toEqual(chord);
	});

	it("rejects stored chords with unknown keys or modifiers", () => {
		expect(parseChord("Ctrl+NotAKey")).toBeNull();
		expect(parseChord("Hyper+KeyK")).toBeNull();
		expect(parseChord("")).toBeNull();
	});
});

describe("resolveKeybinding key names", () => {
	it("accepts digits, punctuation, Esc and named codes, with Cmd and Option aliases", () => {
		expect(serializeChord(resolveKeybinding("Cmd+1", "mac")!)).toBe("Meta+Digit1");
		expect(serializeChord(resolveKeybinding("Option+Esc", "mac")!)).toBe("Alt+Escape");
		expect(serializeChord(resolveKeybinding("Ctrl+F5", "windows")!)).toBe("Ctrl+F5");
	});
});

describe("hasCommandModifier", () => {
	it("is true for Ctrl, Alt or Meta but not Shift alone", () => {
		expect(hasCommandModifier(resolveKeybinding("Shift+A", "linux")!)).toBe(false);
		expect(hasCommandModifier(resolveKeybinding("Alt+A", "linux")!)).toBe(true);
	});
});

describe("detectKeyboardPlatform", () => {
	it("reads the platform from the navigator", () => {
		vi.stubGlobal("navigator", { platform: "MacIntel" });
		expect(detectKeyboardPlatform()).toBe("mac");
		vi.stubGlobal("navigator", { userAgentData: { platform: "Windows" } });
		expect(detectKeyboardPlatform()).toBe("windows");
		vi.stubGlobal("navigator", undefined);
		expect(detectKeyboardPlatform()).toBe("linux");
		vi.unstubAllGlobals();
	});
});
