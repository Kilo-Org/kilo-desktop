import {
	defaultChords,
	parseChord,
	serializeChord,
	type KeybindingCommand,
	type KeyboardPlatform,
	type KeyChord,
} from "@kilo-desktop/kernel";

export type SeriesModifier = "meta" | "ctrl" | "alt";

/**
 * A category's "go to item 1–9" commands, whose defaults share one modifier
 * (⌘1–9 for tabs). `current` is "custom" once a slot was rebound by hand.
 */
export interface NumberKeySeries {
	readonly category: string;
	/** Command key → the digit key it jumps with (`Digit1`…`Digit9`). */
	readonly digits: ReadonlyMap<string, string>;
	readonly commands: readonly string[];
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
	commands: readonly string[],
	digits: ReadonlyMap<string, string>,
	overrides: OverridePlan,
	defaultModifier: SeriesModifier,
): Pick<NumberKeySeries, "current" | "held"> {
	const slots = commands.map((key) => {
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

export function collectNumberKeySeries(
	commands: readonly KeybindingCommand[],
	overrides: OverridePlan,
	platform: KeyboardPlatform,
): NumberKeySeries[] {
	const found = new Map<string, { modifier: SeriesModifier; digits: Map<string, string> }>();
	for (const command of commands) {
		const category = (command.metadata as { category?: string }).category;
		const chords = defaultChords(command, platform);
		const chord = chords.length === 1 ? parseChord(chords[0]!) : null;
		const modifier = digitModifier(chord);
		if (!category || !modifier || !chord) continue;
		const series = found.get(category) ?? { modifier, digits: new Map() };
		if (series.modifier !== modifier) continue;
		series.digits.set(command.key, chord.code);
		found.set(category, series);
	}
	return [...found]
		.filter(([, { digits }]) => digits.size > 1)
		.map(([category, { modifier, digits }]) => {
			const keys = [...digits.keys()];
			return {
				category,
				digits,
				commands: keys,
				defaultModifier: modifier,
				...slotState(keys, digits, overrides, modifier),
			};
		});
}

function overridesFor(series: NumberKeySeries, modifier: SeriesModifier | "none"): OverridePlan {
	return Object.fromEntries(
		series.commands.map((key) => [
			key,
			modifier === "none"
				? null
				: modifier === series.defaultModifier
					? undefined
					: digitChord(series.digits.get(key)!, modifier),
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
	category: string,
	modifier: SeriesModifier | "none",
	choices: readonly SeriesModifier[],
): OverridePlan {
	const target = all.find((series) => series.category === category);
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
	category: string,
	choices: readonly SeriesModifier[],
): OverridePlan {
	const target = all.find((series) => series.category === category);
	if (!target) return {};
	const taken = new Set(
		all.filter((series) => series !== target).flatMap((series) => [...series.held]),
	);
	const modifier =
		[target.defaultModifier, ...choices].find((candidate) => !taken.has(candidate)) ??
		target.defaultModifier;
	return planModifierChange(all, category, modifier, choices);
}
