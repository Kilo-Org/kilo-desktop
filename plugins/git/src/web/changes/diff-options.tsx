/*
	Diff display options for the git Changes tab: a single JSON object under
	`git.diffOptions:v1` (version-suffixed after the `theme:v1` precedent) that
	replaces the five legacy per-option keys, which are now ignored — no
	migration, no deletion.

	Ownership: exactly one `useLocalStorage` instance per key may exist, since
	react-use does not sync same-tab instances; that is why access flows
	exclusively through DiffConfigProvider + useDiffOptions. The provider is
	the single writer, and every write goes through the ref-mirror merge in
	setOpts — react-use's functional-update form closes over stale
	first-render state and must never be used — so back-to-back setOpt calls
	in one tick compose (the ref is updated eagerly, before setStored).

	Sanitize-on-read, self-healing writes: storage is untrusted (hand-edited,
	corrupted, or written by an older schema), so each read passes through
	sanitizeDiffOptions, which validates per field and falls back to defaults,
	so garbage never reaches consumers. Writes always persist a fully valid
	object, so the next read is clean — a bad stored value heals the first
	time the user changes any option. Legacy keys are left in place but never
	read.
*/
import { createContext, useContext, type ReactNode } from "react";
import { useLocalStorage } from "react-use";

import type { DiffIndicators } from "@pierre/diffs";

import { useLatestRef } from "@kilo-desktop/ui/hooks/use-latest-ref";

export type DiffStyle = "split" | "unified";

export interface DiffOptions {
	readonly diffStyle: DiffStyle;
	readonly diffIndicators: DiffIndicators;
	readonly showBackgrounds: boolean;
	readonly showLineNumbers: boolean;
	readonly wrapLines: boolean;
}

export const DIFF_OPTIONS_STORAGE_KEY = "git.diffOptions:v1";

export const DEFAULT_DIFF_OPTIONS: DiffOptions = {
	diffStyle: "unified",
	diffIndicators: "bars",
	showBackgrounds: true,
	showLineNumbers: true,
	wrapLines: true,
};

const DIFF_STYLES: readonly DiffStyle[] = ["split", "unified"];
const DIFF_INDICATORS: readonly DiffIndicators[] = ["bars", "classic", "none"];

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
	return typeof value === "string" && allowed.includes(value as T) ? (value as T) : fallback;
}

function pickBoolean(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

export function sanitizeDiffOptions(raw: unknown): DiffOptions {
	if (!isRecord(raw)) {
		return DEFAULT_DIFF_OPTIONS;
	}
	return {
		diffStyle: pickEnum(raw.diffStyle, DIFF_STYLES, DEFAULT_DIFF_OPTIONS.diffStyle),
		diffIndicators: pickEnum(
			raw.diffIndicators,
			DIFF_INDICATORS,
			DEFAULT_DIFF_OPTIONS.diffIndicators,
		),
		showBackgrounds: pickBoolean(raw.showBackgrounds, DEFAULT_DIFF_OPTIONS.showBackgrounds),
		showLineNumbers: pickBoolean(raw.showLineNumbers, DEFAULT_DIFF_OPTIONS.showLineNumbers),
		wrapLines: pickBoolean(raw.wrapLines, DEFAULT_DIFF_OPTIONS.wrapLines),
	};
}

export type DiffOptionsContextValue = readonly [
	DiffOptions,
	<K extends keyof DiffOptions>(key: K, value: DiffOptions[K]) => void,
	(partial: Partial<DiffOptions>) => void,
];

const diffOptionsContext = createContext<DiffOptionsContextValue | null>(null);

export function DiffConfigProvider({ children }: { children: ReactNode }) {
	const [stored, setStored] = useLocalStorage(DIFF_OPTIONS_STORAGE_KEY, DEFAULT_DIFF_OPTIONS);
	const opts = sanitizeDiffOptions(stored);
	const optsRef = useLatestRef(opts);
	const setOpts = (partial: Partial<DiffOptions>) => {
		const next: DiffOptions = { ...optsRef.current, ...partial };
		// Eager: a second setOpts in the same tick must merge over this
		// write, not over the stale pre-setStored render snapshot.
		optsRef.current = next;
		setStored(next);
	};
	const setOpt = <K extends keyof DiffOptions>(key: K, value: DiffOptions[K]) => {
		setOpts({ [key]: value } satisfies Partial<DiffOptions>);
	};
	const value = [opts, setOpt, setOpts] as const;
	return <diffOptionsContext.Provider value={value}>{children}</diffOptionsContext.Provider>;
}

export function useDiffOptions(): DiffOptionsContextValue {
	const value = useContext(diffOptionsContext);
	if (value == null) {
		throw new Error("useDiffOptions must be used within a DiffConfigProvider");
	}
	return value;
}
