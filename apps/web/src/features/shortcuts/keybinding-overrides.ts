import { useSyncExternalStore } from "react";

import {
	SERIES_MODIFIERS,
	type KeybindingOverride,
	type KeybindingOverrides,
	type SeriesModifier,
} from "./effective-keybindings";

export const KEYBINDING_OVERRIDES_STORAGE_KEY = "shell:keybinding-overrides:v1";

const EMPTY: KeybindingOverrides = {};
const listeners = new Set<() => void>();
let cached: { raw: string | null; value: KeybindingOverrides } | null = null;

function storage(): Storage | null {
	try {
		return globalThis.localStorage ?? null;
	} catch {
		return null;
	}
}

function isOverride(value: unknown): value is KeybindingOverride {
	if (typeof value !== "object" || value === null) return false;
	const { disabled, chords, modifier } = value as Record<string, unknown>;
	if (disabled !== undefined && disabled !== true) return false;
	if (modifier !== undefined && !SERIES_MODIFIERS.includes(modifier as SeriesModifier))
		return false;
	return (
		chords === undefined || (Array.isArray(chords) && chords.every((c) => typeof c === "string"))
	);
}

function parse(raw: string | null): KeybindingOverrides {
	if (!raw) return EMPTY;
	try {
		const value: unknown = JSON.parse(raw);
		if (typeof value !== "object" || value === null) return EMPTY;
		return Object.fromEntries(Object.entries(value).filter(([, entry]) => isOverride(entry)));
	} catch {
		return EMPTY;
	}
}

/** Per-device; every window reads the same localStorage, so main never needs a copy. */
export function readKeybindingOverrides(): KeybindingOverrides {
	let raw: string | null = null;
	try {
		raw = storage()?.getItem(KEYBINDING_OVERRIDES_STORAGE_KEY) ?? null;
	} catch {
		raw = null;
	}
	if (cached?.raw !== raw) cached = { raw, value: parse(raw) };
	return cached.value;
}

function write(next: KeybindingOverrides): void {
	try {
		const store = storage();
		if (Object.keys(next).length === 0) store?.removeItem(KEYBINDING_OVERRIDES_STORAGE_KEY);
		else store?.setItem(KEYBINDING_OVERRIDES_STORAGE_KEY, JSON.stringify(next));
	} catch {
		// Quota / private mode: the change lasts until reload.
	}
	for (const listener of [...listeners]) listener();
}

export function setKeybindingOverride(
	commandId: string,
	override: KeybindingOverride | null,
): void {
	const { [commandId]: _previous, ...rest } = readKeybindingOverrides();
	write(override ? { ...rest, [commandId]: override } : rest);
}

export function setKeybindingOverrides(
	changes: Readonly<Record<string, KeybindingOverride | null>>,
): void {
	const next: Record<string, KeybindingOverride> = { ...readKeybindingOverrides() };
	for (const [key, override] of Object.entries(changes)) {
		if (override) next[key] = override;
		else delete next[key];
	}
	write(next);
}

export function resetKeybindingOverrides(): void {
	write({});
}

export function subscribeKeybindingOverrides(listener: () => void): () => void {
	listeners.add(listener);
	const onStorage = (event: StorageEvent) => {
		if (event.key === KEYBINDING_OVERRIDES_STORAGE_KEY || event.key === null) listener();
	};
	globalThis.addEventListener?.("storage", onStorage);
	return () => {
		listeners.delete(listener);
		globalThis.removeEventListener?.("storage", onStorage);
	};
}

export function useKeybindingOverrides(): KeybindingOverrides {
	return useSyncExternalStore(subscribeKeybindingOverrides, readKeybindingOverrides);
}
