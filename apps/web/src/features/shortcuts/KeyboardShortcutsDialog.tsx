import { SearchIcon } from "lucide-react";
import { useMemo, useRef, useState, type Ref } from "react";

import { detectKeyboardPlatform } from "@kilo-desktop/feature-sdk";
import { useSdk } from "@kilo-desktop/sdk-react";
import { Button } from "@kilo-desktop/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@kilo-desktop/ui/components/dialog";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
	InputGroupText,
} from "@kilo-desktop/ui/components/input-group";

import { computeEffectiveKeybindings } from "./effective-keybindings";
import { useKeybindingOverrides } from "./keybinding-overrides";
import { useListedCommands } from "./known-commands";
import { SHELL_FEATURE_ID } from "./shell-feature";
import { groupShortcutCommands } from "./shortcut-groups";
import { ShortcutRowChip } from "./ShortcutKeys";

export function KeyboardShortcutsDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const sdk = useSdk(SHELL_FEATURE_ID);
	const search = useRef<HTMLInputElement>(null);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				className="max-h-[min(40rem,calc(100dvh-4rem))] grid-rows-[auto_auto_minmax(0,1fr)_auto] sm:max-w-md"
				initialFocus={search}
				data-qa-id="keyboard-shortcuts-dialog"
			>
				<DialogHeader className="pr-6">
					<DialogTitle>Keyboard shortcuts</DialogTitle>
				</DialogHeader>
				<SearchableShortcutList searchRef={search} />
				<DialogFooter className="items-center sm:justify-between">
					<span className="text-muted-foreground text-xs">
						Change any of these in Settings → Shortcuts
					</span>
					<Button
						variant="outline"
						data-qa-id="keyboard-shortcuts-open-settings"
						onClick={() => {
							onOpenChange(false);
							sdk.navigate("/settings/keyboard-shortcuts");
						}}
					>
						Open settings
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/** Mounted only while the dialog is open, so the search starts empty however it was closed. */
function SearchableShortcutList({ searchRef }: { searchRef: Ref<HTMLInputElement> }) {
	const [query, setQuery] = useState("");
	// Every known shortcut, not only the mounted screen's, so Settings' "full list" link is true.
	const commands = useListedCommands();
	const overrides = useKeybindingOverrides();
	const effective = useMemo(
		() => computeEffectiveKeybindings(commands, overrides, detectKeyboardPlatform()).byCommand,
		[commands, overrides],
	);
	const groups = groupShortcutCommands(commands)
		.map((group) => ({
			...group,
			rows: group.rows
				.map((row) => ({
					...row,
					commands: row.commands.filter((command) => (effective[command.id]?.length ?? 0) > 0),
				}))
				.filter((row) => row.commands.length > 0),
		}))
		.filter((group) => group.rows.length > 0);
	const needle = query.trim().toLowerCase();
	const shown = groups
		.map((group) => ({
			...group,
			rows: group.rows.filter((row) => row.label.toLowerCase().includes(needle)),
		}))
		.filter((group) => group.rows.length > 0);
	const total = groups.reduce((sum, group) => sum + group.rows.length, 0);
	const matches = shown.reduce((sum, group) => sum + group.rows.length, 0);

	return (
		<>
			<InputGroup>
				<InputGroupAddon>
					<SearchIcon aria-hidden />
				</InputGroupAddon>
				<InputGroupInput
					ref={searchRef}
					type="text"
					value={query}
					onChange={(event) => setQuery(event.currentTarget.value)}
					placeholder="Search shortcuts"
					aria-label="Search shortcuts"
					data-qa-id="keyboard-shortcuts-search"
				/>
				{needle ? (
					<InputGroupAddon align="inline-end">
						<InputGroupText className="text-xs tabular-nums">
							{matches} of {total}
						</InputGroupText>
					</InputGroupAddon>
				) : null}
			</InputGroup>
			<div
				data-qa-id="keyboard-shortcuts-list"
				className="scroll-fade-y -mx-4 flex min-h-0 flex-col gap-4 overflow-y-auto px-4"
			>
				{shown.length === 0 ? (
					<p className="text-muted-foreground py-6 text-center text-sm">
						No shortcuts match “{query.trim()}”.
					</p>
				) : null}
				{shown.map((group) => (
					<section key={group.name} aria-label={group.name} className="flex flex-col">
						<h3 className="text-muted-foreground pb-1.5 text-xs font-medium">{group.name}</h3>
						<ul className="flex flex-col">
							{group.rows.map((row) => (
								<li
									key={row.key}
									className="flex h-8 items-center justify-between gap-4 text-sm"
									data-qa-id={`keyboard-shortcut-${row.key}`}
								>
									<span className="min-w-0 truncate">{row.label}</span>
									<ShortcutRowChip
										commandIds={row.commands.map((command) => command.id)}
										effective={effective}
									/>
								</li>
							))}
						</ul>
					</section>
				))}
			</div>
		</>
	);
}
