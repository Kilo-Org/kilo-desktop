import type { ShortcutBinding } from "@kilo-desktop/contracts";
import {
	parseChord,
	resolveKeybinding,
	serializeChord,
	type Command,
	type KeyboardPlatform,
	type KeybindingSpec,
} from "@kilo-desktop/feature-sdk";

export type SeriesModifier = "meta" | "ctrl" | "alt" | "none";

export const SERIES_MODIFIERS: readonly SeriesModifier[] = ["meta", "ctrl", "alt", "none"];

/** Keyed by command id, series modifiers by `series:<id>`; chords are canonical. */
export interface KeybindingOverride {
	readonly disabled?: true;
	readonly chords?: readonly string[];
	readonly modifier?: SeriesModifier;
}

export function seriesOverrideKey(seriesId: string): string {
	return `series:${seriesId}`;
}

export type KeybindingOverrides = Readonly<Record<string, KeybindingOverride>>;

export interface EffectiveKeybindings {
	/** Command id → chords it actually owns (empty when disabled or out-claimed). */
	readonly byCommand: Readonly<Record<string, readonly string[]>>;
	readonly bindings: readonly ShortcutBinding[];
	/** Chords requested by more than one command; the first id wins. */
	readonly conflicts: readonly { chord: string; commandIds: readonly string[] }[];
}

function asSpecList(
	keybinding: KeybindingSpec | readonly KeybindingSpec[] | undefined,
): readonly KeybindingSpec[] {
	if (keybinding === undefined) return [];
	return Array.isArray(keybinding) ? keybinding : [keybinding as KeybindingSpec];
}

export function isConfigurable(command: Pick<Command, "handledLocally" | "configurable">): boolean {
	return !command.handledLocally && command.configurable !== false;
}

export function defaultChords(command: Command, platform: KeyboardPlatform): string[] {
	return asSpecList(command.keybinding).flatMap((spec) => {
		const chord = resolveKeybinding(spec, platform);
		return chord ? [serializeChord(chord)] : [];
	});
}

function chosenSeriesModifier(
	command: Command,
	overrides: KeybindingOverrides,
): SeriesModifier | undefined {
	if (!command.series?.modifierChoice) return undefined;
	return overrides[seriesOverrideKey(command.series.id)]?.modifier;
}

function withOnlyModifier(serialized: string, modifier: Exclude<SeriesModifier, "none">): string[] {
	const chord = parseChord(serialized);
	if (!chord) return [];
	return [
		serializeChord({
			code: chord.code,
			meta: modifier === "meta",
			ctrl: modifier === "ctrl",
			alt: modifier === "alt",
			shift: false,
		}),
	];
}

function requestedChords(
	command: Command,
	overrides: KeybindingOverrides,
	platform: KeyboardPlatform,
): string[] {
	const seriesModifier = chosenSeriesModifier(command, overrides);
	if (seriesModifier === "none") return [];
	if (seriesModifier) {
		return defaultChords(command, platform).flatMap((chord) =>
			withOnlyModifier(chord, seriesModifier),
		);
	}
	const override = overrides[command.id];
	if (command.handledLocally || command.configurable === false) {
		return defaultChords(command, platform);
	}
	if (override?.disabled) return [];
	if (override?.chords) return override.chords.filter((chord) => parseChord(chord) !== null);
	return defaultChords(command, platform);
}

/**
 * User choices (rebinds, series modifiers) claim chords first, then defaults in
 * registration order. Locally handled commands are listed but never claim;
 * focus-scoped (`when`) commands never claim but bind chords nobody owns.
 */
export function computeEffectiveKeybindings(
	commands: readonly Command[],
	overrides: KeybindingOverrides,
	platform: KeyboardPlatform,
): EffectiveKeybindings {
	const requests = commands.map((command, index) => ({
		command,
		chords: requestedChords(command, overrides, platform),
		precedence:
			(overrides[command.id]?.chords && isConfigurable(command)) ||
			chosenSeriesModifier(command, overrides) !== undefined
				? 0
				: 1,
		index,
	}));
	const claimOrder = requests
		.filter((request) => !request.command.handledLocally && !request.command.when)
		.toSorted((left, right) => left.precedence - right.precedence || left.index - right.index);

	const owner = new Map<string, string>();
	const contenders = new Map<string, string[]>();
	for (const { command, chords } of claimOrder) {
		for (const chord of chords) {
			contenders.set(chord, [...(contenders.get(chord) ?? []), command.id]);
			if (!owner.has(chord)) owner.set(chord, command.id);
		}
	}

	const byCommand: Record<string, readonly string[]> = {};
	const bindings: ShortcutBinding[] = [];
	for (const { command, chords } of requests) {
		if (command.handledLocally) {
			byCommand[command.id] = chords;
			continue;
		}
		if (command.when) {
			byCommand[command.id] = chords;
			for (const chord of chords) {
				if (owner.has(chord)) continue;
				owner.set(chord, command.id);
				bindings.push({ chord, commandId: command.id });
			}
			continue;
		}
		const owned = chords.filter((chord) => owner.get(chord) === command.id);
		byCommand[command.id] = owned;
		for (const chord of owned) {
			bindings.push({
				chord,
				commandId: command.id,
				...(command.repeatable ? { repeatable: true } : {}),
			});
		}
	}

	const conflicts = [...contenders]
		.filter(([, ids]) => ids.length > 1)
		.map(([chord, commandIds]) => ({ chord, commandIds }));
	return { byCommand, bindings, conflicts };
}

/**
 * Which command a captured chord runs: a focus-scoped command whose `when`
 * holds beats the owner; nothing runs behind a modal dialog.
 */
export function commandForTrigger(
	commands: readonly Command[],
	byCommand: EffectiveKeybindings["byCommand"],
	trigger: { readonly commandId: string; readonly chord: string },
	modalOpen: boolean,
): string | null {
	if (modalOpen) return null;
	const scoped = commands.find(
		(command) => command.when && byCommand[command.id]?.includes(trigger.chord) && command.when(),
	);
	if (scoped) return scoped.id;
	const owner = commands.find((command) => command.id === trigger.commandId);
	return owner && !owner.when ? owner.id : null;
}
