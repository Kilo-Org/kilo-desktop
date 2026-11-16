/** Shortcuts match physical keys; Mod is Command on macOS and Ctrl elsewhere. */

export type KeyboardPlatform = "mac" | "windows" | "linux";

export interface KeyChord {
	readonly code: string;
	readonly ctrl: boolean;
	readonly alt: boolean;
	readonly shift: boolean;
	readonly meta: boolean;
}

export type KeybindingSpec =
	| string
	| {
			readonly mac?: string;
			readonly windows?: string;
			readonly linux?: string;
			readonly default?: string;
	  };

const MODIFIER_ORDER = ["Ctrl", "Alt", "Shift", "Meta"] as const;

const PUNCTUATION_CODES: Readonly<Record<string, string>> = {
	"/": "Slash",
	"\\": "Backslash",
	"[": "BracketLeft",
	"]": "BracketRight",
	"`": "Backquote",
	",": "Comma",
	".": "Period",
	";": "Semicolon",
	"'": "Quote",
	"-": "Minus",
	"=": "Equal",
};

const NAMED_CODES = new Set([
	"ArrowLeft",
	"ArrowRight",
	"ArrowUp",
	"ArrowDown",
	"Tab",
	"Enter",
	"Escape",
	"Backspace",
	"Delete",
	"Space",
	"PageUp",
	"PageDown",
	"Home",
	"End",
	"IntlBackslash",
	"IntlRo",
	"IntlYen",
	"NumpadAdd",
	"NumpadSubtract",
	"NumpadMultiply",
	"NumpadDivide",
	"NumpadDecimal",
	"NumpadEnter",
	...Object.values(PUNCTUATION_CODES),
	...Array.from({ length: 12 }, (_, index) => `F${index + 1}`),
]);

function isKnownCode(code: string): boolean {
	return /^(Key[A-Z]|Digit[0-9]|Numpad[0-9])$/.test(code) || NAMED_CODES.has(code);
}

function keyTokenToCode(token: string): string | null {
	if (/^[a-zA-Z]$/.test(token)) return `Key${token.toUpperCase()}`;
	if (/^[0-9]$/.test(token)) return `Digit${token}`;
	if (token in PUNCTUATION_CODES) return PUNCTUATION_CODES[token]!;
	if (token === "Esc") return "Escape";
	return isKnownCode(token) ? token : null;
}

function selectSpec(spec: KeybindingSpec, platform: KeyboardPlatform): string | null {
	if (typeof spec === "string") return spec;
	return spec[platform] ?? spec.default ?? null;
}

export function resolveKeybinding(
	spec: KeybindingSpec,
	platform: KeyboardPlatform,
): KeyChord | null {
	const source = selectSpec(spec, platform);
	if (!source) return null;
	// "+" is a separator, so a trailing "+" key would be ambiguous; no default uses it.
	const tokens = source.split("+").map((token) => token.trim());
	const keyToken = tokens.pop();
	if (!keyToken) return null;
	const code = keyTokenToCode(keyToken);
	if (!code) return null;

	const chord = { code, ctrl: false, alt: false, shift: false, meta: false };
	for (const token of tokens) {
		switch (token) {
			case "Mod":
				if (platform === "mac") chord.meta = true;
				else chord.ctrl = true;
				break;
			case "Cmd":
			case "Meta":
				chord.meta = true;
				break;
			case "Ctrl":
				chord.ctrl = true;
				break;
			case "Alt":
			case "Option":
				chord.alt = true;
				break;
			case "Shift":
				chord.shift = true;
				break;
			default:
				return null;
		}
	}
	return chord;
}

/** Canonical, platform-resolved form used as a lookup key and for storage. */
export function serializeChord(chord: KeyChord): string {
	const modifiers = MODIFIER_ORDER.filter((modifier) => {
		if (modifier === "Ctrl") return chord.ctrl;
		if (modifier === "Alt") return chord.alt;
		if (modifier === "Shift") return chord.shift;
		return chord.meta;
	});
	return [...modifiers, chord.code].join("+");
}

export function parseChord(serialized: string): KeyChord | null {
	const tokens = serialized.split("+");
	const code = tokens.pop();
	if (!code || !isKnownCode(code)) return null;
	const chord = { code, ctrl: false, alt: false, shift: false, meta: false };
	for (const token of tokens) {
		if (token === "Ctrl") chord.ctrl = true;
		else if (token === "Alt") chord.alt = true;
		else if (token === "Shift") chord.shift = true;
		else if (token === "Meta") chord.meta = true;
		else return null;
	}
	return chord;
}

export interface KeyboardEventLike {
	readonly code: string;
	readonly metaKey: boolean;
	readonly ctrlKey: boolean;
	readonly altKey: boolean;
	readonly shiftKey: boolean;
}

/** Chord for a keydown, or null for lone modifiers and unsupported keys. */
export function chordFromKeyboardEvent(event: KeyboardEventLike): KeyChord | null {
	const code = isKnownCode(event.code) ? event.code : null;
	if (!code) return null;
	return {
		code,
		ctrl: event.ctrlKey,
		alt: event.altKey,
		shift: event.shiftKey,
		meta: event.metaKey,
	};
}

/** True when the chord uses a modifier other than Shift (safe to capture in text fields). */
export function hasCommandModifier(chord: KeyChord): boolean {
	return chord.ctrl || chord.alt || chord.meta;
}

const MAC_KEY_LABELS: Readonly<Record<string, string>> = {
	ArrowLeft: "←",
	ArrowRight: "→",
	ArrowUp: "↑",
	ArrowDown: "↓",
	Enter: "↩",
	Tab: "⇥",
	Backspace: "⌫",
	Delete: "⌦",
	Escape: "Esc",
};

const OTHER_KEY_LABELS: Readonly<Record<string, string>> = {
	ArrowLeft: "←",
	ArrowRight: "→",
	ArrowUp: "↑",
	ArrowDown: "↓",
	Escape: "Esc",
	PageUp: "PgUp",
	PageDown: "PgDn",
};

const NUMPAD_LABELS: Readonly<Record<string, string>> = {
	NumpadAdd: "Num +",
	NumpadSubtract: "Num -",
	NumpadMultiply: "Num *",
	NumpadDivide: "Num /",
	NumpadDecimal: "Num .",
	NumpadEnter: "Num Enter",
};

function keyLabel(code: string, platform: KeyboardPlatform): string {
	if (code.startsWith("Key")) return code.slice(3);
	if (code.startsWith("Digit")) return code.slice(5);
	if (/^Numpad[0-9]$/.test(code)) return `Num ${code.slice(6)}`;
	if (code in NUMPAD_LABELS) return NUMPAD_LABELS[code]!;
	if (code === "IntlBackslash") return platform === "mac" ? "§" : "\\";
	const punctuation = Object.entries(PUNCTUATION_CODES).find(([, value]) => value === code);
	if (punctuation) return punctuation[0];
	const labels = platform === "mac" ? MAC_KEY_LABELS : OTHER_KEY_LABELS;
	return labels[code] ?? code;
}

/** Display key caps, e.g. `["⌥", "⌘", "R"]` on macOS or `["Ctrl", "Alt", "R"]`. */
export function formatChord(chord: KeyChord, platform: KeyboardPlatform): string[] {
	const key = keyLabel(chord.code, platform);
	if (platform === "mac") {
		return [
			...(chord.ctrl ? ["⌃"] : []),
			...(chord.alt ? ["⌥"] : []),
			...(chord.shift ? ["⇧"] : []),
			...(chord.meta ? ["⌘"] : []),
			key,
		];
	}
	return [
		...(chord.ctrl ? ["Ctrl"] : []),
		...(chord.alt ? ["Alt"] : []),
		...(chord.shift ? ["Shift"] : []),
		...(chord.meta ? [platform === "windows" ? "Win" : "Super"] : []),
		key,
	];
}

const CLIPBOARD_CHORDS = (mod: "Ctrl" | "Meta"): Record<string, string> => ({
	[`${mod}+KeyC`]: "Copy",
	[`${mod}+KeyV`]: "Paste",
	[`${mod}+KeyX`]: "Cut",
	[`${mod}+KeyZ`]: "Undo",
	[`${mod === "Ctrl" ? "Ctrl+Shift" : "Shift+Meta"}+KeyZ`]: "Redo",
	[`${mod}+KeyA`]: "Select all",
	[`${mod}+Digit0`]: "Actual size",
	[`${mod}+Equal`]: "Zoom in",
	[`${mod}+Minus`]: "Zoom out",
});

const OTHER_RESERVED: Readonly<Record<string, string>> = {
	...CLIPBOARD_CHORDS("Ctrl"),
	"Ctrl+KeyY": "Redo",
	"Ctrl+Shift+KeyC": "Copy in terminal",
	"Ctrl+Shift+KeyV": "Paste in terminal",
	"Alt+F4": "Close window",
	"Alt+Tab": "Switch windows",
	"Ctrl+Alt+Delete": "the system",
	F11: "Full screen",
};

/** Clipboard, app menu, and OS chords a user rebind must not shadow. */
const RESERVED_CHORDS: Readonly<Record<KeyboardPlatform, Readonly<Record<string, string>>>> = {
	mac: {
		...CLIPBOARD_CHORDS("Meta"),
		"Meta+KeyQ": "Quit",
		"Meta+KeyH": "Hide",
		"Alt+Meta+KeyH": "Hide others",
		"Meta+KeyM": "Minimize",
		"Shift+Meta+KeyW": "Close window",
		"Ctrl+Meta+KeyF": "Full screen",
		"Ctrl+Meta+KeyQ": "Lock screen",
		"Alt+Meta+Escape": "Force quit",
		"Meta+Tab": "Switch apps",
		"Meta+Backquote": "Switch windows",
		"Meta+Space": "Spotlight",
		"Ctrl+Space": "Switch input source",
	},
	windows: OTHER_RESERVED,
	linux: OTHER_RESERVED,
};

/** The action a chord already performs (e.g. "Paste"), or null when it is free to bind. */
export function reservedChordAction(chord: KeyChord, platform: KeyboardPlatform): string | null {
	// Off macOS the Windows/Super key belongs to the OS shell.
	if (platform !== "mac" && chord.meta) return "the system";
	return RESERVED_CHORDS[platform][serializeChord(chord)] ?? null;
}

/** Best-effort platform detection for renderer code. */
export function detectKeyboardPlatform(): KeyboardPlatform {
	const nav = globalThis.navigator as
		| (Navigator & { userAgentData?: { platform?: string } })
		| undefined;
	const platform = nav?.userAgentData?.platform ?? nav?.platform ?? "";
	if (/mac|iphone|ipad/i.test(platform)) return "mac";
	if (/win/i.test(platform)) return "windows";
	return "linux";
}
