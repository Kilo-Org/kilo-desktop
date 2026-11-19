import {
	defaultChords,
	formatChord,
	parseChord,
	serializeChord,
	type KeybindingCommand,
	type KeyboardPlatform,
	type KeyChord,
} from "@kilo-desktop/kernel";
import type { ShortcutsListRow } from "@kilo-desktop/plugin-shell/contracts";

import { WORK_SESSIONS_PLUGIN_ID } from "../../contracts";
import { NUMBERED_SLOTS } from "../shared/numbered";

export type SeriesModifier = "meta" | "ctrl" | "alt";

/** A "go to item 1–9" set App Navigation edits as one: its commands in slot order. */
export interface NumberSetDefinition {
	readonly id: string;
	readonly title: string;
	/** The set's one row in the ⌘/ list. */
	readonly listTitle: string;
	readonly commands: readonly string[];
}

const slotCommands = (series: "pane" | "work-session") =>
	NUMBERED_SLOTS.map(
		(slot) => `${WORK_SESSIONS_PLUGIN_ID}/${series}-${slot === 9 ? "last" : slot}`,
	);

export const NUMBER_SETS: readonly NumberSetDefinition[] = [
	{ id: "tabs", title: "Tabs", listTitle: "Go to tab 1–9", commands: slotCommands("pane") },
	{
		id: "sessions",
		title: "Sessions",
		listTitle: "Go to session 1–9",
		commands: slotCommands("work-session"),
	},
];

/** A set as the user has it now. `current` is "custom" once a slot was rebound by hand. */
export interface NumberKeySeries {
	readonly definition: NumberSetDefinition;
	/** Command key → the digit key it jumps with by default (`Digit1`…`Digit9`). */
	readonly digits: ReadonlyMap<string, string>;
	readonly defaultModifier: SeriesModifier;
	readonly current: SeriesModifier | "none" | "custom";
	/** Modifiers its slots jump with now; a custom set can hold one on most slots. */
	readonly held: ReadonlySet<SeriesModifier>;
}

/** Command key → a chord, `null` for off, or `undefined` to go back to the default. */
export type OverridePlan = Readonly<Record<string, string | null | undefined>>;

function digitModifier(chord: KeyChord | null): SeriesModifier | null {
	if (!chord || !/^Digit[1-9]$/.test(chord.code) || chord.shift) return null;
	const held = (["meta", "ctrl", "alt"] as const).filter((modifier) => chord[modifier]);
	return held.length === 1 ? held[0]! : null;
}

function digitChord(code: string, modifier: SeriesModifier): string {
	return serializeChord({
		code,
		meta: modifier === "meta",
		ctrl: modifier === "ctrl",
		alt: modifier === "alt",
		shift: false,
	});
}

function slotState(
	digits: ReadonlyMap<string, string>,
	overrides: OverridePlan,
	defaultModifier: SeriesModifier,
): Pick<NumberKeySeries, "current" | "held"> {
	const slots = [...digits.keys()].map((key) => {
		const override = overrides[key];
		if (override === undefined) return defaultModifier;
		if (override === null) return "none";
		const chord = parseChord(override);
		return chord?.code === digits.get(key) ? (digitModifier(chord) ?? "custom") : "custom";
	});
	const distinct = new Set(slots);
	return {
		current: distinct.size === 1 ? [...distinct][0]! : "custom",
		held: new Set(
			slots.filter((slot): slot is SeriesModifier => slot !== "none" && slot !== "custom"),
		),
	};
}

/**
 * Each set's state on this platform. A slot whose default isn't one modifier
 * plus a digit has no key to keep, so it takes no part; a set left with
 * fewer than two slots, or whose slots disagree on the default modifier, is
 * dropped.
 */
export function collectNumberKeySeries(
	sets: readonly NumberSetDefinition[],
	commands: readonly KeybindingCommand[],
	overrides: OverridePlan,
	platform: KeyboardPlatform,
): NumberKeySeries[] {
	const byKey = new Map(commands.map((command) => [command.key, command]));
	return sets.flatMap((definition) => {
		const digits = new Map<string, string>();
		const modifiers = new Set<SeriesModifier>();
		for (const key of definition.commands) {
			const command = byKey.get(key);
			const chords = command ? defaultChords(command, platform) : [];
			const chord = chords.length === 1 ? parseChord(chords[0]!) : null;
			const modifier = digitModifier(chord);
			if (!modifier || !chord) continue;
			modifiers.add(modifier);
			digits.set(key, chord.code);
		}
		if (digits.size < 2 || modifiers.size !== 1) return [];
		const defaultModifier = [...modifiers][0]!;
		return [
			{ definition, digits, defaultModifier, ...slotState(digits, overrides, defaultModifier) },
		];
	});
}

function overridesFor(series: NumberKeySeries, modifier: SeriesModifier | "none"): OverridePlan {
	return Object.fromEntries(
		[...series.digits].map(([key, code]) => [
			key,
			modifier === "none"
				? null
				: modifier === series.defaultModifier
					? undefined
					: digitChord(code, modifier),
		]),
	);
}

/**
 * Taking a modifier another set holds swaps the two. When the target has no
 * modifier to hand over (it is off or custom), the holder moves to the first
 * free choice instead, so two sets never share chords. Turning off takes
 * nothing, so it never touches another set.
 */
export function planModifierChange(
	all: readonly NumberKeySeries[],
	setId: string,
	modifier: SeriesModifier | "none",
	choices: readonly SeriesModifier[],
): OverridePlan {
	const target = all.find((series) => series.definition.id === setId);
	if (!target) return {};
	const plan = { ...overridesFor(target, modifier) };
	if (modifier === "none") return plan;
	const others = all.filter((series) => series !== target);
	for (const holder of others.filter((series) => series.held.has(modifier))) {
		const taken = new Set([
			modifier,
			...others.filter((series) => series !== holder).flatMap((series) => [...series.held]),
		]);
		const handover =
			target.current !== "none" && target.current !== "custom" && !taken.has(target.current)
				? target.current
				: choices.find((choice) => !taken.has(choice));
		Object.assign(plan, overridesFor(holder, handover ?? "none"));
	}
	return plan;
}

/** The default modifier when free, else the first free choice. */
export function planTurnOn(
	all: readonly NumberKeySeries[],
	setId: string,
	choices: readonly SeriesModifier[],
): OverridePlan {
	const target = all.find((series) => series.definition.id === setId);
	if (!target) return {};
	const taken = new Set(
		all.filter((series) => series !== target).flatMap((series) => [...series.held]),
	);
	const modifier =
		[target.defaultModifier, ...choices].find((candidate) => !taken.has(candidate)) ??
		target.defaultModifier;
	return planModifierChange(all, setId, modifier, choices);
}

/** Keys written as one label: "⌘1" on macOS, "Ctrl+1" elsewhere. */
export function keysLabel(keys: readonly string[], platform: KeyboardPlatform): string {
	return keys.join(platform === "mac" ? "" : "+");
}

/** A modifier's keys as shown ("⌘", or "Ctrl" elsewhere). */
export function modifierKeys(modifier: SeriesModifier, platform: KeyboardPlatform): string[] {
	return formatChord(parseChord(digitChord("Digit1", modifier))!, platform).slice(0, -1);
}

/** "⌘1–9" ("Ctrl+1–9" elsewhere) for a set on one modifier; null when it is off or custom. */
export function seriesRangeLabel(
	series: NumberKeySeries,
	platform: KeyboardPlatform,
): string | null {
	const modifier = series.current;
	if (modifier === "none" || modifier === "custom") return null;
	return `${keysLabel([...modifierKeys(modifier, platform), "1"], platform)}–9`;
}

/**
 * The ⌘/ list's rows: one per set on one modifier. An off set lists nothing
 * and a custom one gets no row, so the list shows its slots one by one.
 */
export function listRows(
	series: readonly NumberKeySeries[],
	titles: ReadonlyMap<string, string>,
	platform: KeyboardPlatform,
): ShortcutsListRow[] {
	return series.flatMap((entry) => {
		const label = seriesRangeLabel(entry, platform);
		if (!label) return [];
		const commands = [...entry.digits.keys()];
		return [
			{
				title: entry.definition.listTitle,
				labels: [label],
				commands,
				searchText: commands.map((key) => titles.get(key) ?? "").join(" "),
			},
		];
	});
}
