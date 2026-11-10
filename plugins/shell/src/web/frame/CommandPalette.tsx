import { useMemo } from "react";

import {
	formatChord,
	KernelCommand,
	parseChord,
	type KeyboardPlatform,
	type KeyChord,
} from "@kilo-desktop/kernel";
import { useExtensions, useKernel } from "@kilo-desktop/kernel/web";
import {
	Command,
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandShortcut,
} from "@kilo-desktop/ui/components/command";

import { usePaletteOpen } from "./ui-state";

function chordLabel(chord: KeyChord, platform: KeyboardPlatform): string {
	return formatChord(chord, platform).join(platform === "mac" ? "" : "+");
}

/**
 * Every command a person can run right now (its `when` holds and it is
 * implemented somewhere), grouped by category with its effective shortcut.
 */
export function CommandPalette() {
	const kernel = useKernel();
	const [open, setOpen] = usePaletteOpen();
	const commands = useExtensions(KernelCommand);
	const shortcuts = useMemo(() => {
		const byCommand = new Map<string, string>();
		for (const [key, chords] of Object.entries(kernel.keyboard.resolution().byCommand)) {
			const parsed = chords[0] ? parseChord(chords[0]) : null;
			if (parsed) byCommand.set(key, chordLabel(parsed, kernel.keyboard.platform));
		}
		return byCommand;
		// Recomputed whenever the command list changes; overrides arrive through the same notifications.
	}, [kernel, commands]);

	const groups = useMemo(() => {
		const byCategory = new Map<string, typeof commands>();
		for (const command of commands) {
			if (!command.metadata.palette) continue;
			const category = command.metadata.category ?? "Other";
			byCategory.set(category, [...(byCategory.get(category) ?? []), command]);
		}
		return [...byCategory];
	}, [commands]);

	return (
		<CommandDialog open={open} onOpenChange={setOpen} title="Commands" description="Run a command">
			<Command data-qa-id="command-palette">
				<CommandInput placeholder="Type a command…" data-qa-id="command-palette-input" />
				<CommandList>
					<CommandEmpty>No matching commands.</CommandEmpty>
					{groups.map(([category, categoryCommands]) => (
						<CommandGroup key={category} heading={category}>
							{categoryCommands.map((command) => (
								<CommandItem
									key={command.key}
									value={`${category} ${command.metadata.title}`}
									data-qa-id={`command-palette-item-${command.key}`}
									onSelect={() => {
										setOpen(false);
										void kernel.commands.execute(command.key).catch((error: unknown) => {
											kernel.kernelSdk.logger.error(`Command "${command.key}" failed`, error);
										});
									}}
								>
									<span>{command.metadata.title}</span>
									{shortcuts.has(command.key) ? (
										<CommandShortcut>{shortcuts.get(command.key)}</CommandShortcut>
									) : null}
								</CommandItem>
							))}
						</CommandGroup>
					))}
				</CommandList>
			</Command>
		</CommandDialog>
	);
}
