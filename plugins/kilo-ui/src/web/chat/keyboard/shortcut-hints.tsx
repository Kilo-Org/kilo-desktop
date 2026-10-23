import { useMemo, useSyncExternalStore } from "react";

import {
	detectKeyboardPlatform,
	formatChord,
	parseChord,
	type KeyboardPlatform,
	type KeyChord,
} from "@kilo-desktop/feature-sdk";
import { useEffectiveKeybindings } from "@kilo-desktop/sdk-react";

import { idAtShortcutSlot, NUMBERED_SLOTS } from "./numbered-shortcuts.js";

/**
 * Shows number chips on tabs and session rows while the user holds the
 * modifier of a numbered series. One window listener set is shared by every
 * subscriber; the reveal waits a beat so quick chords like ⌘C don't flash
 * chips. Any non-modifier key, releasing a modifier, or window blur hides them;
 * releasing the number key of a jump does not, so they stay while held.
 *
 * Hiding flips a root attribute first so the chips vanish on the next paint;
 * the React update that drops them re-renders SessionPage and the session list,
 * so it runs after that paint instead of delaying it.
 *
 * Main consumes a jump's keydown, after which Chromium drops key events until
 * the next keydown; ElectronShortcuts resumes them so the release arrives.
 */

type HeldModifiers = Omit<KeyChord, "code">;

const REVEAL_DELAY_MS = 150;
const MODIFIER_KEYS = new Set(["Meta", "Control", "Alt", "Shift"]);
const HIDDEN_ATTRIBUTE = "data-shortcut-hints-hidden";

let held: HeldModifiers | null = null;
let shown = false;
let revealTimer: ReturnType<typeof setTimeout> | undefined;
let clearTimer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function setHeld(next: HeldModifiers | null) {
	if (held === next) return;
	held = next;
	for (const listener of listeners) listener();
}

function show(next: HeldModifiers) {
	clearTimeout(clearTimer);
	shown = true;
	document.documentElement.removeAttribute(HIDDEN_ATTRIBUTE);
	setHeld(next);
}

function hide() {
	clearTimeout(revealTimer);
	if (!shown) return;
	shown = false;
	document.documentElement.setAttribute(HIDDEN_ATTRIBUTE, "");
	clearTimer = setTimeout(() => setHeld(null));
}

function onKeyUp(event: KeyboardEvent) {
	if (MODIFIER_KEYS.has(event.key)) hide();
}

function onKeyDown(event: KeyboardEvent) {
	// Windows repeats a held Ctrl; restarting the timer on each repeat would never reveal.
	if (event.repeat) return;
	if (!MODIFIER_KEYS.has(event.key)) return hide();
	const next = {
		ctrl: event.ctrlKey,
		alt: event.altKey,
		shift: event.shiftKey,
		meta: event.metaKey,
	};
	clearTimeout(revealTimer);
	if (shown) show(next);
	else revealTimer = setTimeout(() => show(next), REVEAL_DELAY_MS);
}

function subscribe(listener: () => void) {
	if (listeners.size === 0) {
		window.addEventListener("keydown", onKeyDown, true);
		window.addEventListener("keyup", onKeyUp, true);
		window.addEventListener("blur", hide);
	}
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
		if (listeners.size > 0) return;
		window.removeEventListener("keydown", onKeyDown, true);
		window.removeEventListener("keyup", onKeyUp, true);
		window.removeEventListener("blur", hide);
		hide();
	};
}

function sameModifiers(a: HeldModifiers, b: HeldModifiers): boolean {
	return a.ctrl === b.ctrl && a.alt === b.alt && a.shift === b.shift && a.meta === b.meta;
}

/** Item id → chip label ("⌘1", "Ctrl+9") for slots whose chord uses exactly the held modifiers. */
export function shortcutHints(
	commandPrefix: "tab" | "session",
	ids: readonly string[],
	effective: Readonly<Record<string, readonly string[]>>,
	modifiers: HeldModifiers | null,
	platform: KeyboardPlatform,
): ReadonlyMap<string, string> {
	const hints = new Map<string, string>();
	if (!modifiers) return hints;
	for (const slot of NUMBERED_SLOTS) {
		const id = idAtShortcutSlot(ids, slot);
		// Slot 9 is "last", which may already hold its own positional number.
		if (!id || hints.has(id)) continue;
		const commandId = `kilo-ui.${commandPrefix}-${slot === 9 ? "last" : slot}`;
		const chord = effective[commandId]
			?.map(parseChord)
			.find((candidate) => candidate !== null && sameModifiers(candidate, modifiers));
		if (chord) hints.set(id, formatChord(chord, platform).join(platform === "mac" ? "" : "+"));
	}
	return hints;
}

export function useShortcutHints(
	commandPrefix: "tab" | "session",
	ids: readonly string[],
): ReadonlyMap<string, string> {
	const effective = useEffectiveKeybindings();
	const platform = detectKeyboardPlatform();
	// Modifiers this surface has no chips for (⌥ on tabs, Shift anywhere) never re-render it.
	const modifiers = useSyncExternalStore(subscribe, () =>
		held && shortcutHints(commandPrefix, ids, effective, held, platform).size > 0 ? held : null,
	);
	return useMemo(
		() => shortcutHints(commandPrefix, ids, effective, modifiers, platform),
		[commandPrefix, effective, ids, modifiers, platform],
	);
}

export function ShortcutHintChip({ label }: { label: string }) {
	return (
		<kbd
			aria-hidden
			data-slot="shortcut-hint"
			className="bg-foreground/10 text-foreground inline-flex h-4 shrink-0 items-center rounded-[4px] px-1 font-sans text-[10px] leading-none font-medium tabular-nums [[data-shortcut-hints-hidden]_&]:hidden"
		>
			{label}
		</kbd>
	);
}
