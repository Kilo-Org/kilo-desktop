import { SearchIcon } from "lucide-react";
import { useRef, useState, type Ref } from "react";
import { useNavigate } from "@tanstack/react-router";

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

import { useShortcutsOpen } from "./ui-state";
import { groupShortcutCommands } from "../shared/shortcuts/shortcut-groups";
import { chordLabels, ShortcutChip } from "../shared/shortcuts/ShortcutKeys";
import { useShortcuts } from "../shared/shortcuts/use-shortcuts";
import { seriesRangeLabel, useNumberKeySeries } from "../settings/NumberKeysSettings";

/** The keyboard cheat sheet (⌘/): every bound shortcut, searchable. */
export function KeyboardShortcutsDialog() {
	const [open, setOpen] = useShortcutsOpen();
	const navigate = useNavigate();
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
							void navigate({ to: "/settings/keyboard-shortcuts" });
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
	// A 1–9 set on one modifier reads as one row ("Go to tab 1–9"); a custom set keeps its rows.
	const series = useNumberKeySeries().filter((entry) => entry.current !== "custom");
	const seriesByFirst = new Map(series.map((entry) => [entry.commands[0], entry]));
	const inSeries = new Set(series.flatMap((entry) => entry.commands));
	const titles = new Map<string, string>(
		commands.map((command) => [command.key, command.metadata.title]),
	);
	const groups = groupShortcutCommands(commands)
		.map((group) => ({
			name: group.name,
			rows: group.commands.flatMap((command) => {
				const entry = seriesByFirst.get(command.key);
				if (entry) {
					const label = seriesRangeLabel(entry, platform);
					const members = entry.commands.map((key) => titles.get(key) ?? "");
					return label
						? [
								{
									key: command.key,
									title: command.metadata.title.replace(/ 1$/, " 1–9"),
									searchText: members.join(" "),
									labels: [label],
								},
							]
						: [];
				}
				if (inSeries.has(command.key)) return [];
				const labels = chordLabels(resolution.byCommand[command.key] ?? [], platform);
				return labels.length > 0
					? [
							{
								key: command.key,
								title: command.metadata.title,
								searchText: command.metadata.title,
								labels,
							},
						]
					: [];
			}),
		}))
		.filter((group) => group.rows.length > 0);
	const needle = query.trim().toLowerCase();
	const shown = groups
		.map((group) => ({
			...group,
			rows: group.rows.filter((row) =>
				`${row.title} ${row.searchText}`.toLowerCase().includes(needle),
			),
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
									<span className="min-w-0 truncate">{row.title}</span>
									<ShortcutChip labels={row.labels} />
								</li>
							))}
						</ul>
					</section>
				))}
			</div>
		</>
	);
}
