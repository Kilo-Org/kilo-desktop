import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import {
	formatChord,
	parseChord,
	type KeyboardPlatform,
	type KeyChord,
} from "@kilo-desktop/kernel";
import { useKernel } from "@kilo-desktop/kernel/web";

import { WORKBENCH_PLUGIN_ID } from "../contracts";
import { idAtShortcutSlot, NUMBERED_SLOTS } from "./numbered-sessions";

/*
 * Number chips on session rows and tabs while the user holds the modifier of
 * a numbered series (⌃1–9 sessions, ⌘1–9 tabs), as origin showed them. One
 * set of window listeners is shared by every subscriber; the reveal waits a
 * beat so quick chords like ⌘C don't flash chips. Any non-modifier key,
 * releasing a modifier, or window blur hides them; releasing the number key
 * of a jump does not, so they stay while held.
 *
 * Hiding flips a root attribute first so the chips vanish on the next paint;
 * the React update that drops them runs after that paint instead of delaying
 * it. Main consumes a jump's keydown, after which Chromium drops key events
 * until the next keydown; the desktop host resumes them so the release
 * arrives.
 */

type HeldModifiers = Omit<KeyChord, "code">;
export type NumberedSeries = "session" | "pane";

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

/** Item id → chip label ("⌃1", "Alt+9") for slots whose chord uses exactly the held modifiers. */
export function shortcutHints(
	series: NumberedSeries,
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
		const commandId = `${WORKBENCH_PLUGIN_ID}/${series}-${slot === 9 ? "last" : slot}`;
		const chord = effective[commandId]
			?.map(parseChord)
			.find((candidate) => candidate !== null && sameModifiers(candidate, modifiers));
		if (chord) hints.set(id, formatChord(chord, platform).join(platform === "mac" ? "" : "+"));
	}
	return hints;
}

const NO_HINTS: ReadonlyMap<string, string> = new Map();

export function useShortcutHints(
	series: NumberedSeries,
	ids: readonly string[],
): ReadonlyMap<string, string> {
	const { keyboard } = useKernel();
	const [bindingsVersion, setBindingsVersion] = useState(0);
	useEffect(
		() => keyboard.subscribe(() => setBindingsVersion((version) => version + 1)),
		[keyboard],
	);
	// Recomputed whenever the bindings change.
	const effective = useMemo(() => keyboard.resolution().byCommand, [keyboard, bindingsVersion]);
	// Modifiers this surface has no chips for (Shift anywhere) never re-render it.
	const modifiers = useSyncExternalStore(subscribe, () =>
		held && shortcutHints(series, ids, effective, held, keyboard.platform).size > 0 ? held : null,
	);
	return useMemo(
		() =>
			modifiers ? shortcutHints(series, ids, effective, modifiers, keyboard.platform) : NO_HINTS,
		[effective, ids, keyboard.platform, modifiers, series],
	);
}
