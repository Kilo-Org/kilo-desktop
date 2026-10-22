/**
 * Ghostty's default app-level keybinds, evaluated ahead of ghostty-web's key
 * encoder. ghostty-web ports only the VT core; the native app's keybind table
 * (src/config/Config.zig) is where Cmd+Left/Right become line editing, so the
 * frame supplies the subset that applies to a single embedded terminal.
 */
export type TerminalKeyAction =
	| { readonly kind: "input"; readonly data: string }
	| { readonly kind: "copy" }
	| { readonly kind: "select-all" }
	| { readonly kind: "clear" }
	| { readonly kind: "scroll"; readonly to: "top" | "bottom" | "page-up" | "page-down" };

export type TerminalKeyPlatform = "mac" | "other";

export interface TerminalKeyEventLike {
	readonly key: string;
	readonly code: string;
	readonly metaKey: boolean;
	readonly ctrlKey: boolean;
	readonly altKey: boolean;
	readonly shiftKey: boolean;
}

const MAC_BINDINGS: ReadonlyMap<string, TerminalKeyAction> = new Map([
	["super+ArrowLeft", { kind: "input", data: "\x01" }],
	["super+ArrowRight", { kind: "input", data: "\x05" }],
	["super+Backspace", { kind: "input", data: "\x15" }],
	["alt+ArrowLeft", { kind: "input", data: "\x1bb" }],
	["alt+ArrowRight", { kind: "input", data: "\x1bf" }],
	["super+c", { kind: "copy" }],
	["super+a", { kind: "select-all" }],
	["super+k", { kind: "clear" }],
	["super+Home", { kind: "scroll", to: "top" }],
	["super+End", { kind: "scroll", to: "bottom" }],
	["super+PageUp", { kind: "scroll", to: "page-up" }],
	["super+PageDown", { kind: "scroll", to: "page-down" }],
]);

// Ctrl+C stays SIGINT, so copy moves to Ctrl+Shift like Ghostty on Linux.
const OTHER_BINDINGS: ReadonlyMap<string, TerminalKeyAction> = new Map([
	["ctrl+shift+c", { kind: "copy" }],
	["ctrl+shift+a", { kind: "select-all" }],
	["shift+Home", { kind: "scroll", to: "top" }],
	["shift+End", { kind: "scroll", to: "bottom" }],
	["shift+PageUp", { kind: "scroll", to: "page-up" }],
	["shift+PageDown", { kind: "scroll", to: "page-down" }],
]);

function chordOf(event: TerminalKeyEventLike): string {
	const mods = [
		event.ctrlKey ? "ctrl" : null,
		event.altKey ? "alt" : null,
		event.shiftKey ? "shift" : null,
		event.metaKey ? "super" : null,
	].filter((mod) => mod !== null);
	// Letters match on the translated character like Ghostty's `unicode` keys;
	// everything else matches on the physical key.
	const keyId = event.key.length === 1 ? event.key.toLowerCase() : event.code;
	return [...mods, keyId].join("+");
}

export interface NavigatorPlatformLike {
	readonly platform?: string;
	readonly userAgentData?: { readonly platform?: string } | undefined;
}

export function terminalKeyPlatformFrom(navigatorLike: NavigatorPlatformLike): TerminalKeyPlatform {
	const platform = navigatorLike.userAgentData?.platform || navigatorLike.platform || "";
	return /^mac/i.test(platform) ? "mac" : "other";
}

export interface TerminalKeyModes {
	/** DECCKM (DEC private mode 1): shells enter it via terminfo `smkx`. */
	readonly cursorKeysApplication: boolean;
}

// ghostty-web encodes Home/End as CSI H / CSI F regardless of DECCKM. Ghostty's
// encoder switches to SS3 in application mode, which is what xterm-256color's
// khome/kend advertise, so zsh/bash key tables only recognize this form there.
const APPLICATION_CURSOR_KEYS: ReadonlyMap<string, TerminalKeyAction> = new Map([
	["Home", { kind: "input", data: "\x1bOH" }],
	["End", { kind: "input", data: "\x1bOF" }],
]);

export function terminalKeyAction(
	event: TerminalKeyEventLike,
	platform: TerminalKeyPlatform,
	modes: TerminalKeyModes = { cursorKeysApplication: false },
): TerminalKeyAction | null {
	const chord = chordOf(event);
	const bindings = platform === "mac" ? MAC_BINDINGS : OTHER_BINDINGS;
	return (
		bindings.get(chord) ??
		(modes.cursorKeysApplication ? APPLICATION_CURSOR_KEYS.get(chord) : undefined) ??
		null
	);
}
