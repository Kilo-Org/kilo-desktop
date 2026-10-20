import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";

import {
	EFFECTIVE_KEYBINDINGS_STORE,
	type Command,
	type CommandDefinition,
} from "@kilo-desktop/feature-sdk";

import { useFeatureSystem } from "./SdkProvider.js";

const EMPTY_BINDINGS: Readonly<Record<string, readonly string[]>> = {};

/**
 * Registers a command while mounted and `enabled`. The handler can change every
 * render without re-registering.
 */
export function useCommand(featureId: string, definition: CommandDefinition, enabled = true): void {
	const system = useFeatureSystem();
	const handlerRef = useRef(definition.handler);
	handlerRef.current = definition.handler;
	const whenRef = useRef(definition.when);
	whenRef.current = definition.when;
	const { handler: _handler, when, ...metadata } = definition;
	const metadataKey = JSON.stringify({ ...metadata, scoped: when !== undefined });

	useEffect(() => {
		if (!enabled) return;
		const { scoped, ...stable } = JSON.parse(metadataKey) as Omit<
			CommandDefinition,
			"handler" | "when"
		> & { scoped: boolean };
		return system.getSdk(featureId).commands.register({
			...stable,
			...(scoped ? { when: () => whenRef.current?.() ?? false } : {}),
			handler: () => handlerRef.current(),
		});
	}, [enabled, featureId, metadataKey, system]);
}

export function useCommands(): readonly Command[] {
	const { commandRegistry } = useFeatureSystem().services;
	const snapshot = useRef<readonly Command[]>(commandRegistry.all());
	const subscribe = useCallback(
		(notify: () => void) => {
			// Catch registrations made between render and subscribe (e.g. an earlier effect).
			snapshot.current = commandRegistry.all();
			return commandRegistry.subscribe(() => {
				snapshot.current = commandRegistry.all();
				notify();
			});
		},
		[commandRegistry],
	);
	return useSyncExternalStore(subscribe, () => snapshot.current);
}

/** Command id → effective canonical chords, published by the shell. */
export function useEffectiveKeybindings(): Readonly<Record<string, readonly string[]>> {
	const { stateBroker } = useFeatureSystem().services;
	const store = useMemo(
		() => stateBroker.get<Record<string, readonly string[]>>(EFFECTIVE_KEYBINDINGS_STORE),
		[stateBroker],
	);
	return useSyncExternalStore(store.subscribe, () => store.peek() ?? EMPTY_BINDINGS);
}
