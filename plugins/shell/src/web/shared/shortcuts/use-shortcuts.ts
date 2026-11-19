import { useRef, useSyncExternalStore } from "react";

import {
	KernelCommand,
	KernelKeybindings,
	type CommandContribution,
	type KeybindingResolution,
} from "@kilo-desktop/kernel";
import {
	useDomainObject,
	useDomainObjectState,
	useKernel,
	type RendererKernel,
} from "@kilo-desktop/kernel/web";

const EMPTY_OVERRIDES: Readonly<Record<string, string | null>> = {};
const selectOverrides = (state: { overrides: Readonly<Record<string, string | null>> }) =>
	state.overrides;

/** Every implemented command, whatever its `when`, so shortcuts of other screens are listed too. */
export function useDeclaredCommands(): readonly CommandContribution[] {
	const kernel = useKernel();
	const cache = useRef<{ signature: string; commands: readonly CommandContribution[] } | null>(
		null,
	);
	const read = () => {
		const commands = kernel.commands.declared();
		const signature = JSON.stringify(commands.map((command) => [command.key, command.metadata]));
		if (cache.current?.signature !== signature) cache.current = { signature, commands };
		return cache.current.commands;
	};
	return useSyncExternalStore(
		(onChange) =>
			kernel.extensions.subscribe((pointId) => {
				if (pointId === KernelCommand.id) onChange();
			}),
		read,
		read,
	);
}

/**
 * The kernel resolves from its own state; `commands` and `overrides` are taken
 * only to key memoization on what that state is derived from.
 */
function resolveKeybindings(
	keyboard: RendererKernel["keyboard"],
	_commands: readonly CommandContribution[],
	_overrides: Readonly<Record<string, string | null>>,
): KeybindingResolution {
	return keyboard.resolution();
}

/** Commands, the user's overrides and the effective bindings they produce. */
export function useShortcuts() {
	const kernel = useKernel();
	const commands = useDeclaredCommands();
	const keybindings = useDomainObject(KernelKeybindings);
	const overrides = useDomainObjectState(KernelKeybindings, selectOverrides) ?? EMPTY_OVERRIDES;
	const resolution = resolveKeybindings(kernel.keyboard, commands, overrides);
	return { commands, overrides, resolution, keybindings, platform: kernel.keyboard.platform };
}
