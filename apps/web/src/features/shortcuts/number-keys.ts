import { parseChord, type Command, type KeyboardPlatform } from "@kilo-desktop/feature-sdk";

import {
	defaultChords,
	seriesOverrideKey,
	type KeybindingOverride,
	type KeybindingOverrides,
	type SeriesModifier,
} from "./effective-keybindings";

export interface NumberKeySeries {
	readonly id: string;
	readonly label: string;
	readonly current: SeriesModifier;
	readonly defaultModifier: SeriesModifier;
}

export interface ModifierChangePlan {
	/** Override key → new override, or null to drop it (back to default). */
	readonly changes: Readonly<Record<string, KeybindingOverride | null>>;
	readonly swappedWith?: string;
}

function overrideFor(series: NumberKeySeries, modifier: SeriesModifier): KeybindingOverride | null {
	return modifier === series.defaultModifier ? null : { modifier };
}

/**
 * Taking another series' modifier swaps the two. An off series never passes
 * "off" on, so changing one series can't silently turn the other off.
 */
export function planModifierChange(
	all: readonly NumberKeySeries[],
	targetId: string,
	modifier: SeriesModifier,
): ModifierChangePlan {
	const target = all.find((series) => series.id === targetId);
	if (!target) return { changes: {} };
	const changes: Record<string, KeybindingOverride | null> = {
		[seriesOverrideKey(target.id)]: overrideFor(target, modifier),
	};
	const holder =
		modifier === "none"
			? undefined
			: all.find((series) => series.id !== targetId && series.current === modifier);
	if (!holder || target.current === "none") return { changes };
	changes[seriesOverrideKey(holder.id)] = overrideFor(holder, target.current);
	return { changes, swappedWith: holder.id };
}

/** Default modifier when free, else the first free choice. */
export function planTurnOn(
	all: readonly NumberKeySeries[],
	targetId: string,
	choices: readonly Exclude<SeriesModifier, "none">[],
): ModifierChangePlan {
	const target = all.find((series) => series.id === targetId);
	if (!target) return { changes: {} };
	const taken = new Set(all.filter((series) => series.id !== targetId).map((s) => s.current));
	const preferred = [target.defaultModifier, ...choices].filter(
		(modifier): modifier is Exclude<SeriesModifier, "none"> => modifier !== "none",
	);
	const modifier = preferred.find((candidate) => !taken.has(candidate)) ?? preferred[0];
	if (!modifier) return { changes: {} };
	return planModifierChange(all, targetId, modifier);
}

function modifierOf(chord: string | undefined): SeriesModifier {
	const parsed = chord ? parseChord(chord) : null;
	if (!parsed) return "none";
	if (parsed.meta) return "meta";
	if (parsed.ctrl) return "ctrl";
	if (parsed.alt) return "alt";
	return "none";
}

export function collectNumberKeySeries(
	commands: readonly Command[],
	overrides: KeybindingOverrides,
	platform: KeyboardPlatform,
): (NumberKeySeries & { readonly group: string | undefined })[] {
	const found = new Map<string, NumberKeySeries & { readonly group: string | undefined }>();
	for (const command of commands) {
		const series = command.series;
		if (!series?.modifierChoice || found.has(series.id)) continue;
		const defaultModifier = modifierOf(defaultChords(command, platform)[0]);
		found.set(series.id, {
			id: series.id,
			label: series.label,
			group: command.group,
			defaultModifier,
			current: overrides[seriesOverrideKey(series.id)]?.modifier ?? defaultModifier,
		});
	}
	return [...found.values()];
}
