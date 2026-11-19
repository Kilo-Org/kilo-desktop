import { KernelCommand, type CommandHandler } from "./builtins/extension-points";
import { KernelError } from "./errors";
import {
	WINDOW_ORIGIN_PREFIX,
	type Contribution,
	type ExtensionRegistry,
} from "./extension-registry";
import type { QualifiedId } from "./ids";
import {
	parseChord,
	resolveKeybinding,
	sameModifiers,
	serializeChord,
	type KeybindingSpec,
	type KeyboardPlatform,
} from "./keybindings";
import type { KernelLogger } from "./sdk";
import type { KernelTransport } from "./transport";

export type CommandContribution = Contribution<typeof KernelCommand>;

const CHANNELS = {
	execute: "kernel:command-execute",
	run: "kernel:command-run",
	executeInWindow: "kernel:command-execute-in-window",
} as const;

interface ExecutePayload {
	readonly key: QualifiedId;
	readonly args?: unknown;
}

export interface CommandServiceOptions {
	readonly process: "main" | "renderer";
	readonly extensions: ExtensionRegistry;
	readonly transport?: KernelTransport;
	/** Main: the focused window's id, preferred when several windows implement a command. */
	readonly focusedWindow?: () => string | undefined;
	/** Renderer: where a forwarded command that fails is reported. */
	readonly logger?: KernelLogger;
}

/**
 * Executes commands by key wherever they are implemented. A renderer forwards
 * to main when it does not have the handler; main runs it or forwards it to
 * the implementing window (fire-and-forget; the focused one when several
 * do), so a secondary window can run a command only the main window
 * implements. A forwarded command that fails is logged in its window.
 */
export class CommandService {
	readonly #options: CommandServiceOptions;

	constructor(options: CommandServiceOptions) {
		this.#options = options;
		const { transport } = options;
		if (!transport) return;
		if (options.process === "main") {
			transport.handle(CHANNELS.execute, (payload) => {
				const { key, args } = payload as ExecutePayload;
				return this.execute(key, args);
			});
		} else {
			transport.on(CHANNELS.run, (payload) => {
				const { key, args } = payload as ExecutePayload;
				void Promise.resolve()
					.then(() => this.#runLocal(key, args))
					.catch((error: unknown) =>
						options.logger?.error(`Command "${key}" forwarded from main failed`, error),
					);
			});
			transport.on(CHANNELS.executeInWindow, (payload) => {
				const { key, args } = payload as ExecutePayload;
				this.execute(key, args).catch((error: unknown) =>
					options.logger?.error(`Command "${key}" requested by main failed`, error),
				);
			});
		}
	}

	/** Active commands: their `when` holds and they are implemented in some process. */
	list(): CommandContribution[] {
		return this.#options.extensions.list(KernelCommand);
	}

	/** Every command implemented in some process, whatever its `when` (for listing shortcuts). */
	declared(): CommandContribution[] {
		return this.#options.extensions
			.all(KernelCommand)
			.filter((command) => command.implementation !== undefined || command.implementedRemotely);
	}

	async execute(key: string, args?: unknown): Promise<unknown> {
		const { transport, process, extensions } = this.#options;
		// A window only learns main's implementations, so a command another
		// window implements is declared here but listed only in main.
		const command =
			this.list().find((candidate) => candidate.key === key) ??
			(process === "renderer" && transport
				? extensions
						.all(KernelCommand)
						.find((candidate) => candidate.key === key && candidate.implementation === undefined)
				: undefined);
		if (!command) throw new KernelError("NOT_FOUND", `No available command "${key}".`);
		if (command.implementation) return command.implementation(args);
		if (!transport) throw new KernelError("UNAVAILABLE", `Command "${key}" is not reachable.`);
		const payload: ExecutePayload = { key: command.key, ...(args === undefined ? {} : { args }) };
		if (process === "renderer") return transport.request(CHANNELS.execute, payload);
		const windows = extensions
			.implementationOrigins(KernelCommand.id, command.key)
			.filter((origin) => origin.startsWith(WINDOW_ORIGIN_PREFIX))
			.map((origin) => origin.slice(WINDOW_ORIGIN_PREFIX.length));
		const focused = this.#options.focusedWindow?.();
		const window = windows.find((windowId) => windowId === focused) ?? windows[0];
		if (window === undefined) {
			throw new KernelError("UNAVAILABLE", `Command "${key}" is not reachable.`);
		}
		transport.send(CHANNELS.run, payload, { toWindow: window });
		return undefined;
	}

	/**
	 * Main: executes a command as if it were invoked in `windowId` (e.g. from
	 * that window's native menu), so the window's own `when` conditions decide
	 * and a command it doesn't implement is forwarded as usual. Fire-and-forget;
	 * a failure is logged in the window.
	 */
	executeInWindow(windowId: string, key: string, args?: unknown): void {
		const { transport, process } = this.#options;
		if (process !== "main" || !transport) {
			throw new KernelError("UNAVAILABLE", "Only main executes commands in a window.");
		}
		const payload = { key, ...(args === undefined ? {} : { args }) };
		transport.send(CHANNELS.executeInWindow, payload, { toWindow: windowId });
	}

	#runLocal(key: QualifiedId, args: unknown): unknown {
		const command = this.list().find((candidate) => candidate.key === key);
		const handler = command?.implementation as CommandHandler | undefined;
		if (!handler) throw new KernelError("NOT_FOUND", `No available command "${key}".`);
		return handler(args);
	}
}

type LooseKeybindingSpec =
	| string
	| {
			readonly mac?: string | undefined;
			readonly windows?: string | undefined;
			readonly linux?: string | undefined;
			readonly default?: string | undefined;
	  };

export interface KeybindingCommand {
	readonly key: string;
	/** Has a `when` condition: it never contests a chord, and wins it while the condition holds. */
	readonly scoped: boolean;
	readonly metadata: {
		readonly keybinding?: LooseKeybindingSpec | readonly LooseKeybindingSpec[] | undefined;
		/** Listed with its chords, but never bound: its owner handles the key. */
		readonly handledLocally?: boolean | undefined;
	};
}

function toSpec(spec: LooseKeybindingSpec): KeybindingSpec {
	if (typeof spec === "string") return spec;
	return Object.fromEntries(
		Object.entries(spec).filter(([, value]) => value !== undefined),
	) as KeybindingSpec;
}

/** A command's default chords for the platform, canonical. */
export function defaultChords(command: KeybindingCommand, platform: KeyboardPlatform): string[] {
	const { keybinding } = command.metadata;
	if (keybinding === undefined) return [];
	const specs = Array.isArray(keybinding) ? keybinding : [keybinding as LooseKeybindingSpec];
	return specs.flatMap((spec) => {
		const chord = resolveKeybinding(toSpec(spec), platform);
		return chord ? [serializeChord(chord)] : [];
	});
}

export interface KeybindingResolution {
	/** Command key → the chords it actually has (empty when turned off or out-claimed). */
	readonly byCommand: Readonly<Record<string, readonly string[]>>;
	/** Canonical chord → commands bound to it: the owner first, then conditional commands. */
	readonly bindings: Readonly<Record<string, readonly string[]>>;
	/** Chords wanted by more than one unconditional command; the first command keeps it. */
	readonly conflicts: readonly { readonly chord: string; readonly commands: readonly string[] }[];
}

/**
 * Effective keybindings. User overrides (one chord, or `null` for off) claim
 * chords first, then defaults in command order; the first claimer keeps a
 * contested chord and the rest are reported as conflicts. Conditional
 * commands never contest a chord: they share it and win while their `when`
 * holds.
 */
export function resolveKeybindings(input: {
	readonly commands: readonly KeybindingCommand[];
	readonly overrides: Readonly<Record<string, string | null>>;
	readonly platform: KeyboardPlatform;
}): KeybindingResolution {
	const requested = input.commands.map((command, index) => {
		const override = input.overrides[command.key];
		const overridden = command.key in input.overrides;
		const chords = overridden
			? override === null || override === undefined || !parseChord(override)
				? []
				: [override]
			: defaultChords(command, input.platform);
		return { command, chords, precedence: overridden ? 0 : 1, index };
	});

	const owner = new Map<string, string>();
	const contenders = new Map<string, string[]>();
	const claimers = requested
		.filter((request) => !request.command.scoped && !request.command.metadata.handledLocally)
		.sort((a, b) => a.precedence - b.precedence || a.index - b.index);
	for (const { command, chords } of claimers) {
		for (const chord of chords) {
			contenders.set(chord, [...(contenders.get(chord) ?? []), command.key]);
			if (!owner.has(chord)) owner.set(chord, command.key);
		}
	}

	const byCommand: Record<string, string[]> = {};
	const bindings: Record<string, string[]> = {};
	for (const [chord, key] of owner) bindings[chord] = [key];
	for (const { command, chords } of requested) {
		if (command.metadata.handledLocally) {
			byCommand[command.key] = chords;
		} else if (command.scoped) {
			byCommand[command.key] = chords;
			for (const chord of chords) (bindings[chord] ??= []).push(command.key);
		} else {
			byCommand[command.key] = chords.filter((chord) => owner.get(chord) === command.key);
		}
	}
	const conflicts = [...contenders]
		.filter(([, keys]) => keys.length > 1)
		.map(([chord, commands]) => ({ chord, commands }));
	return { byCommand, bindings, conflicts };
}

export interface SeriesCommand {
	readonly key: string;
	readonly metadata: KeybindingCommand["metadata"] & {
		readonly category?: string | undefined;
		readonly series?: string | undefined;
	};
}

/**
 * A series is changed as one (Settings → Shortcuts): untouched, every member
 * on the same new modifiers keeping its own key, or every member off. True
 * when its overrides fit one of those.
 */
function isUniformSeries(
	members: readonly SeriesCommand[],
	overrides: Readonly<Record<string, string | null>>,
	platform: KeyboardPlatform,
): boolean {
	if (!members.some((member) => member.key in overrides)) return true;
	const pairs = members.flatMap((member) => {
		const [fallback] = defaultChords({ ...member, scoped: false }, platform);
		const own = fallback ? parseChord(fallback) : null;
		// Without a default on this platform it has no key to keep, so it takes no part.
		if (!own) return [];
		const override = overrides[member.key];
		const chord = member.key in overrides ? (override ? parseChord(override) : null) : own;
		return [{ own, chord }];
	});
	if (pairs.every(({ chord }) => chord === null)) return true;
	const [first] = pairs;
	return pairs.every(
		({ own, chord }) =>
			chord !== null && chord.code === own.code && sameModifiers(chord, first!.chord!),
	);
}

/**
 * Overridden commands of series that were changed one command at a time,
 * e.g. saved before the commands formed a series: resetting them restores a
 * series that can be shown and changed as one row. For a plugin's one-time
 * migration; run on every launch it would also reset series whose members
 * or defaults changed since the user set them.
 */
export function mixedSeriesOverrides(input: {
	readonly commands: readonly SeriesCommand[];
	readonly overrides: Readonly<Record<string, string | null>>;
	readonly platform: KeyboardPlatform;
}): string[] {
	const series = new Map<string, SeriesCommand[]>();
	for (const command of input.commands) {
		const name = command.metadata.series;
		if (name === undefined) continue;
		const id = JSON.stringify([command.metadata.category ?? null, name]);
		series.set(id, [...(series.get(id) ?? []), command]);
	}
	return [...series.values()]
		.filter((members) => !isUniformSeries(members, input.overrides, input.platform))
		.flatMap((members) =>
			members.filter((member) => member.key in input.overrides).map((member) => member.key),
		);
}

export interface KeyboardServiceOptions {
	readonly commands: CommandService;
	readonly platform: KeyboardPlatform;
	readonly overrides: () => Readonly<Record<string, string | null>>;
}

/** Resolves chords to commands for the current window, honouring `when` and overrides. */
export class KeyboardService {
	readonly #options: KeyboardServiceOptions;

	constructor(options: KeyboardServiceOptions) {
		this.#options = options;
	}

	resolution(): KeybindingResolution {
		return resolveKeybindings({
			commands: this.#options.commands.declared().map((command) => ({
				key: command.key,
				scoped: command.when !== undefined,
				metadata: command.metadata,
			})),
			overrides: this.#options.overrides(),
			platform: this.#options.platform,
		});
	}

	/** Chords that are bound, for the host's key capture. */
	chords(): string[] {
		return Object.keys(this.resolution().bindings);
	}

	/**
	 * Runs the command a chord means right now: a conditional command whose
	 * `when` holds, otherwise the chord's owner. Among conditional commands the
	 * last contributed wins (as later keybinding rules do in VS Code), so a
	 * plugin can narrow a chord another plugin binds under a broader
	 * condition. Resolves false when nothing runs.
	 */
	async dispatch(chord: string): Promise<boolean> {
		const keys = this.resolution().bindings[chord] ?? [];
		const active = new Map(this.#options.commands.list().map((command) => [command.key, command]));
		const key =
			keys.findLast((candidate) => active.get(candidate as QualifiedId)?.when !== undefined) ??
			keys.find((candidate) => active.has(candidate as QualifiedId));
		if (!key) return false;
		await this.#options.commands.execute(key);
		return true;
	}
}
