import { describe, expect, it } from "vitest";

import {
	defaultChords,
	type KeybindingCommand,
	type KeyboardPlatform,
	type WhenExpression,
} from "@kilo-desktop/kernel";

import { BUNDLED_PLUGINS } from "./plugins";

interface DeclaredCommand extends KeybindingCommand {
	readonly when: WhenExpression | undefined;
}

interface CommandDeclaration {
	readonly id: string;
	readonly keybinding?: KeybindingCommand["metadata"]["keybinding"];
	readonly handledLocally?: boolean;
	readonly when?: WhenExpression;
}

interface ManifestWithCommands {
	readonly id: string;
	readonly contributes?: {
		readonly extensions?: { readonly "kernel/command"?: readonly CommandDeclaration[] };
	};
}

const PLATFORMS: readonly KeyboardPlatform[] = ["mac", "windows", "linux"];

/**
 * Chords two commands share on purpose: the first narrows the second while a
 * more specific context holds (the later contribution wins, kernel
 * `KeyboardService.dispatch`). Every entry says why.
 */
const INTENTIONAL_OVERRIDES: readonly { readonly narrower: string; readonly broader: string }[] = [
	// ⌘K clears a focused terminal instead of opening session search (as in a shell).
	{ narrower: "kilo.terminal/clear", broader: "kilo.workbench/search" },
];

function bundledCommands(): DeclaredCommand[] {
	return BUNDLED_PLUGINS.flatMap((plugin) => {
		const manifest = plugin.manifest as ManifestWithCommands;
		return (manifest.contributes?.extensions?.["kernel/command"] ?? []).map((command) => ({
			key: `${manifest.id}/${command.id}`,
			scoped: command.when !== undefined,
			when: command.when,
			metadata: { keybinding: command.keybinding, handledLocally: command.handledLocally },
		}));
	});
}

/** Whether some context could satisfy both conditions (no key required by one and excluded by the other). */
function overlap(a: WhenExpression | undefined, b: WhenExpression | undefined): boolean {
	const contradicts = (x: WhenExpression | undefined, y: WhenExpression | undefined) =>
		(x?.all ?? []).some((key) => (y?.none ?? []).includes(key));
	return !contradicts(a, b) && !contradicts(b, a);
}

/**
 * An unconditional command yields to any conditional one, by design; two
 * commands under the same kind of condition that can hold together are
 * ambiguous unless listed as an intentional override.
 */
function collides(a: DeclaredCommand, b: DeclaredCommand): boolean {
	if (a.scoped !== b.scoped) return false;
	if (!overlap(a.when, b.when)) return false;
	return !INTENTIONAL_OVERRIDES.some(
		({ narrower, broader }) =>
			(a.key === narrower && b.key === broader) || (a.key === broader && b.key === narrower),
	);
}

function collisions(platform: KeyboardPlatform): string[] {
	const byChord = new Map<string, DeclaredCommand[]>();
	for (const command of bundledCommands()) {
		for (const chord of defaultChords(command, platform)) {
			byChord.set(chord, [...(byChord.get(chord) ?? []), command]);
		}
	}
	const found: string[] = [];
	for (const [chord, commands] of byChord) {
		commands.forEach((a, index) => {
			for (const b of commands.slice(index + 1)) {
				if (collides(a, b)) found.push(`${chord}: ${a.key} and ${b.key}`);
			}
		});
	}
	return found;
}

describe("bundled default keybindings", () => {
	it.each(PLATFORMS)(
		"give no chord to two commands that can be active together on %s",
		(platform) => {
			expect(collisions(platform)).toEqual([]);
		},
	);

	it("keep every intentional override's chords shared, so the list stays current", () => {
		const commands = new Map(bundledCommands().map((command) => [command.key, command]));
		for (const { narrower, broader } of INTENTIONAL_OVERRIDES) {
			const shared = PLATFORMS.some((platform) => {
				const chords = defaultChords(commands.get(broader)!, platform);
				return defaultChords(commands.get(narrower)!, platform).some((chord) =>
					chords.includes(chord),
				);
			});
			expect(shared, `${narrower} / ${broader}`).toBe(true);
		}
	});
});
