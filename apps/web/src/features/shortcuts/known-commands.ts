import { useMemo, useSyncExternalStore } from "react";

import type { Command } from "@kilo-desktop/feature-sdk";
import { useCommands } from "@kilo-desktop/sdk-react";

export const KNOWN_COMMANDS_STORAGE_KEY = "shell:known-shortcut-commands:v1";

/** `when` can't be stored, so focus-scoped commands keep only a flag. */
export type KnownCommand = Omit<Command, "handler" | "when"> & { readonly scoped?: true };

const listeners = new Set<() => void>();
let known: readonly KnownCommand[] = load();

function load(): readonly KnownCommand[] {
	try {
		const raw = globalThis.localStorage?.getItem(KNOWN_COMMANDS_STORAGE_KEY);
		const value: unknown = raw ? JSON.parse(raw) : [];
		if (!Array.isArray(value)) return [];
		return value.filter(
			(entry): entry is KnownCommand =>
				typeof entry === "object" &&
				entry !== null &&
				typeof (entry as KnownCommand).id === "string" &&
				typeof (entry as KnownCommand).label === "string",
		);
	} catch {
		return [];
	}
}

function persist(): void {
	try {
		globalThis.localStorage?.setItem(KNOWN_COMMANDS_STORAGE_KEY, JSON.stringify(known));
	} catch {
		// Quota / private mode: Settings lists only this session's commands.
	}
}

function toKnown({ handler: _handler, when, ...metadata }: Command): KnownCommand {
	return when ? { ...metadata, scoped: true } : metadata;
}

/**
 * Commands exist only while their surface is mounted, so Settings lists and
 * rebinds from this remembered catalog.
 */
export function rememberCommands(commands: readonly Command[]): void {
	const byId = new Map(known.map((command) => [command.id, command]));
	let changed = false;
	for (const command of commands) {
		if (command.keybinding === undefined) continue;
		const next = toKnown(command);
		if (JSON.stringify(byId.get(command.id)) === JSON.stringify(next)) continue;
		byId.set(command.id, next);
		changed = true;
	}
	if (!changed) return;
	known = [...byId.values()];
	persist();
	for (const listener of [...listeners]) listener();
}

export function useKnownCommands(): readonly KnownCommand[] {
	return useSyncExternalStore(
		(listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		() => known,
	);
}

const noop = () => undefined;

/** Registered commands, plus remembered ones whose surface is not mounted here. */
export function useListedCommands(): readonly Command[] {
	const live = useCommands();
	const known = useKnownCommands();
	return useMemo(() => {
		const liveIds = new Set(live.map((command) => command.id));
		return [
			...live,
			...known
				.filter((command) => !liveIds.has(command.id))
				.map(({ scoped, ...command }) => ({
					...command,
					handler: noop,
					...(scoped ? { when: () => false } : {}),
				})),
		];
	}, [known, live]);
}
