import { SearchIcon } from "lucide-react";
import { useRef, useState, type Ref } from "react";

import { useDomain } from "@kilo-desktop/kernel/web";
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

import { Navigation } from "../../contracts";
import { useShortcutsOpen } from "../ui-state";
import { groupShortcutCommands } from "./shortcut-groups";
import { chordLabels, ShortcutChip } from "./ShortcutKeys";
import { useShortcuts } from "./use-shortcuts";

/** The keyboard cheat sheet (⌘/): every bound shortcut, searchable. */
export function KeyboardShortcutsDialog() {
	const [open, setOpen] = useShortcutsOpen();
	const navigation = useDomain(Navigation);
	const search = useRef<HTMLInputElement>(null);

	return (
		<Dialog open={open} onOpenChange={setOpen}>
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
							setOpen(false);
							void navigation?.methods.openSettings({ section: "keyboard-shortcuts" });
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
function SearchableShortcutList({ searchRef }: { readonly searchRef: Ref<HTMLInputElement> }) {
	const [query, setQuery] = useState("");
	const { commands, resolution, platform } = useShortcuts();
	const groups = groupShortcutCommands(commands)
		.map((group) => ({
			...group,
			commands: group.commands.filter(
				(command) => (resolution.byCommand[command.key]?.length ?? 0) > 0,
			),
		}))
		.filter((group) => group.commands.length > 0);
	const needle = query.trim().toLowerCase();
	const shown = groups
		.map((group) => ({
			...group,
			commands: group.commands.filter((command) =>
				command.metadata.title.toLowerCase().includes(needle),
			),
		}))
		.filter((group) => group.commands.length > 0);
	const total = groups.reduce((sum, group) => sum + group.commands.length, 0);
	const matches = shown.reduce((sum, group) => sum + group.commands.length, 0);

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
							{group.commands.map((command) => (
								<li
									key={command.key}
									className="flex h-8 items-center justify-between gap-4 text-sm"
									data-qa-id={`keyboard-shortcut-${command.key}`}
								>
									<span className="min-w-0 truncate">{command.metadata.title}</span>
									<ShortcutChip
										labels={chordLabels(resolution.byCommand[command.key] ?? [], platform)}
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
