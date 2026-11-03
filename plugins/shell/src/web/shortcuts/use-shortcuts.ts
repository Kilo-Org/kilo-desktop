import { useMemo, useRef, useSyncExternalStore } from "react";

import { KernelCommand, KernelKeybindings, type CommandContribution } from "@kilo-desktop/kernel";
import { useDomain, useDomainState, useKernel } from "@kilo-desktop/kernel/web";

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

/** Commands, the user's overrides and the effective bindings they produce. */
export function useShortcuts() {
	const kernel = useKernel();
	const commands = useDeclaredCommands();
	const keybindings = useDomain(KernelKeybindings);
	const overrides = useDomainState(KernelKeybindings, selectOverrides) ?? EMPTY_OVERRIDES;
	const resolution = useMemo(
		() => kernel.keyboard.resolution(),
		// Recomputed whenever commands or overrides change.
		[kernel, commands, overrides],
	);
	return { commands, overrides, resolution, keybindings, platform: kernel.keyboard.platform };
}
