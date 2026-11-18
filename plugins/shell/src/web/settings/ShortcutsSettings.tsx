import { RotateCcwIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";

import {
	chordFromKeyboardEvent,
	defaultChords,
	formatChord,
	hasCommandModifier,
	parseChord,
	reservedChordAction,
	serializeChord,
	type CommandContribution,
	type KeybindingResolution,
	type KeyboardPlatform,
	type KeyChord,
} from "@kilo-desktop/kernel";
import { useKernel } from "@kilo-desktop/kernel/web";
import { Button } from "@kilo-desktop/ui/components/button";
import {
	FieldContent,
	FieldDescription,
	FieldLegend,
	FieldSet,
} from "@kilo-desktop/ui/components/field";
import { SettingsPageHeader } from "@kilo-desktop/ui/components/settings-page-header";
import { SummaryCard } from "@kilo-desktop/ui/components/summary-card";
import { cn } from "@kilo-desktop/ui/lib/utils";

import { groupShortcutCommands, type ShortcutRow } from "../shared/shortcuts/shortcut-groups";
import {
	keysLabel,
	rowChordLabels,
	SHORTCUT_CHIP,
	ShortcutLabels,
} from "../shared/shortcuts/ShortcutKeys";
import { useShortcuts } from "../shared/shortcuts/use-shortcuts";

/**
 * The shortcut as one chip: clicking it records new keys, and hovering or
 * focusing it reveals × to turn the shortcut off. While recording, every
 * shortcut is paused so the pressed keys reach the recorder.
 */
function ShortcutField({
	commandKey,
	label,
	labels,
	platform,
	prompt = "Type the new keys…",
	expand = (chord) => [chord],
	onRecord,
	onTurnOff,
}: {
	readonly commandKey: string;
	readonly label: string;
	readonly labels: readonly string[];
	readonly platform: KeyboardPlatform;
	readonly prompt?: string;
	/** The chords one recorded chord stands for; each must be free to bind. */
	readonly expand?: (chord: KeyChord) => readonly KeyChord[];
	readonly onRecord: (chords: readonly KeyChord[]) => void;
	readonly onTurnOff: () => void;
}) {
	const kernel = useKernel();
	const [recording, setRecording] = useState(false);
	const [rejection, setRejection] = useState<string | null>(null);
	useEffect(() => {
		if (!recording) setRejection(null);
	}, [recording]);
	useEffect(() => {
		if (!recording) return;
		kernel.keyboard.setRecording(true);
		return () => kernel.keyboard.setRecording(false);
	}, [recording, kernel]);

	const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
		if (!recording) return;
		event.preventDefault();
		event.stopPropagation();
		if (event.key === "Escape" && !event.metaKey && !event.ctrlKey && !event.altKey) {
			setRecording(false);
			return;
		}
		const chord = chordFromKeyboardEvent(event.nativeEvent);
		// Plain or Shift-only keys would hijack typing, so a shortcut needs ⌘, ⌃, or ⌥.
		if (!chord || !hasCommandModifier(chord)) return;
		const chords = expand(chord);
		for (const candidate of chords) {
			const reservedFor = reservedChordAction(candidate, platform);
			if (!reservedFor) continue;
			setRejection(
				`${keysLabel(formatChord(candidate, platform), platform)} is reserved for ${reservedFor}.`,
			);
			return;
		}
		onRecord(chords);
		setRecording(false);
	};

	return (
		<div
			className={cn(
				SHORTCUT_CHIP,
				"group/field gap-0 p-0 transition-colors hover:bg-(color:--state-selected-strong)",
				recording && "ring-ring bg-transparent ring-2 hover:bg-transparent",
			)}
		>
			<button
				type="button"
				aria-label={
					recording ? `Recording a new shortcut for ${label}` : `Change shortcut for ${label}`
				}
				data-qa-id={`shortcut-recorder-${commandKey}`}
				data-recording={recording ? "true" : undefined}
				onClick={() => setRecording(true)}
				onBlur={() => setRecording(false)}
				onKeyDown={onKeyDown}
				className="focus-visible:ring-ring/50 flex h-full items-center gap-1.5 rounded-full px-2.5 outline-none focus-visible:ring-3"
			>
				{recording ? (
					<span
						role="status"
						className={cn("font-normal", rejection ? "text-warning" : "text-muted-foreground")}
						data-qa-id={rejection ? `shortcut-rejected-${commandKey}` : undefined}
					>
						{rejection ?? prompt}
					</span>
				) : labels.length > 0 ? (
					<ShortcutLabels labels={labels} />
				) : (
					<span className="text-muted-foreground font-normal">None</span>
				)}
			</button>
			{!recording && labels.length > 0 ? (
				<button
					type="button"
					aria-label={`Turn off ${label}`}
					data-qa-id={`shortcut-turn-off-${commandKey}`}
					onClick={onTurnOff}
					className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 grid h-4.5 w-0 shrink-0 place-items-center overflow-hidden rounded-full opacity-0 transition-[width,opacity,margin] duration-150 ease-out outline-none group-focus-within/field:mr-1.25 group-focus-within/field:-ml-1.25 group-focus-within/field:w-4.5 group-focus-within/field:opacity-100 group-hover/field:mr-1.25 group-hover/field:-ml-1.25 group-hover/field:w-4.5 group-hover/field:opacity-100 focus-visible:ring-3"
				>
					<XIcon className="size-3" aria-hidden />
				</button>
			) : null}
		</div>
	);
}

type Keybindings = ReturnType<typeof useShortcuts>["keybindings"];

/** The key a series member keeps when the series' modifiers change, e.g. 3 for "Go to tab 3". */
function seriesMemberCode(command: CommandContribution, platform: KeyboardPlatform) {
	const [chord] = defaultChords(
		{ key: command.key, scoped: false, metadata: command.metadata },
		platform,
	);
	return chord ? parseChord(chord)?.code : undefined;
}

/**
 * One listed shortcut. A series row ("Go to tab 1–9") changes all its
 * commands together: the recorded modifiers apply to every command, each
 * keeping its own key, and × or reset applies to every command.
 */
function ShortcutRowItem({
	row,
	overrides,
	resolution,
	conflict,
	keybindings,
	platform,
}: {
	readonly row: ShortcutRow;
	readonly overrides: Readonly<Record<string, string | null>>;
	readonly resolution: KeybindingResolution;
	readonly conflict: string | undefined;
	readonly keybindings: Keybindings;
	readonly platform: KeyboardPlatform;
}) {
	const keys = row.commands.map((command) => command.key);
	const overridden = keys.some((key) => key in overrides);
	const [first] = row.commands;
	// Series members without a default on this platform have no key to keep, so they are left out.
	const members = row.commands.flatMap((command) => {
		const code = seriesMemberCode(command, platform);
		return code ? [{ key: command.key, code }] : [];
	});
	const memberKeys = members.map(({ key }) => key);
	const enabled = (row.series ? memberKeys : keys).some((key) => overrides[key] !== null);
	const labels = enabled ? rowChordLabels(row, resolution.byCommand, platform) : [];
	const setAll = (chords: readonly (KeyChord | null)[], targets: readonly string[]) =>
		void Promise.all(
			targets.map((command, index) => {
				const chord = chords[index];
				return keybindings?.methods.setOverride({
					command,
					chord: chord ? serializeChord(chord) : null,
				});
			}),
		);

	return (
		// The row sets border-0, so the li carries the list's divider.
		<li data-qa-id={`shortcut-row-${row.key}`}>
			<SummaryCard.Row>
				<SummaryCard.Content>
					<SummaryCard.Title className={cn("truncate", !enabled && "text-muted-foreground")}>
						{row.title}
					</SummaryCard.Title>
					{conflict && enabled ? (
						<SummaryCard.Description
							className="text-warning"
							data-qa-id={`shortcut-conflict-${row.key}`}
						>
							Its shortcut is used by “{conflict}”.
						</SummaryCard.Description>
					) : null}
				</SummaryCard.Content>
				<SummaryCard.Actions className="gap-1">
					{first?.metadata.handledLocally ? (
						<span className={cn(SHORTCUT_CHIP, "px-2.5")} data-qa-id={`shortcut-fixed-${row.key}`}>
							<ShortcutLabels labels={labels} />
						</span>
					) : row.series ? (
						<ShortcutField
							commandKey={row.key}
							label={row.title}
							labels={labels}
							platform={platform}
							prompt="Hold the new modifiers and press any key…"
							expand={(chord) => members.map(({ code }) => ({ ...chord, code }))}
							onRecord={(chords) => setAll(chords, memberKeys)}
							onTurnOff={() => setAll([], memberKeys)}
						/>
					) : (
						<ShortcutField
							commandKey={row.key}
							label={row.title}
							labels={labels}
							platform={platform}
							onRecord={(chords) => setAll(chords, [row.key])}
							onTurnOff={() => setAll([], [row.key])}
						/>
					)}
					<span className="flex size-6 shrink-0 items-center justify-center">
						{overridden ? (
							<Button
								variant="ghost"
								size="icon-xs"
								aria-label={`Reset ${row.title}`}
								data-qa-id={`shortcut-reset-${row.key}`}
								onClick={() =>
									void Promise.all(
										keys
											.filter((command) => command in overrides)
											.map((command) => keybindings?.methods.reset({ command })),
									)
								}
							>
								<RotateCcwIcon aria-hidden />
							</Button>
						) : null}
					</span>
				</SummaryCard.Actions>
			</SummaryCard.Row>
		</li>
	);
}

/** Settings → Shortcuts: every command with a shortcut, grouped, each one changeable. */
export function ShortcutsSettings() {
	const kernel = useKernel();
	const { commands, overrides, resolution, keybindings, platform } = useShortcuts();
	const titles = useMemo(
		() =>
			new Map<string, string>(
				commands.map((command) => [command.key, command.metadata.series ?? command.metadata.title]),
			),
		[commands],
	);
	const takenBy = useMemo(() => {
		const map = new Map<string, string>();
		for (const { commands: contenders } of resolution.conflicts) {
			const [winner, ...losers] = contenders;
			for (const loser of losers) map.set(loser, titles.get(winner!) ?? winner!);
		}
		return map;
	}, [resolution.conflicts, titles]);
	const groups = groupShortcutCommands(commands);
	const hasOverrides = Object.keys(overrides).length > 0;

	return (
		<div className="flex min-w-0 flex-col gap-6" data-qa-id="keyboard-shortcuts-settings">
			<SettingsPageHeader
				actions={
					<Button
						variant="outline"
						size="sm"
						disabled={!hasOverrides}
						onClick={() => void keybindings?.methods.resetAll(undefined)}
						data-qa-id="keyboard-shortcuts-reset-all"
					>
						<RotateCcwIcon aria-hidden />
						Reset all
					</Button>
				}
			/>
			<FieldSet className="min-w-0" aria-labelledby="all-shortcuts-heading">
				<FieldContent>
					<FieldLegend id="all-shortcuts-heading" variant="label" className="mb-0">
						All shortcuts
					</FieldLegend>
					<FieldDescription>
						To change a shortcut, select it and press the new keys (Esc cancels). To turn one off,
						hover it and select ×. Shortcuts you can’t change, like Enter to send, are in the{" "}
						{/* Styled like FieldDescription's own links, which only targets <a>. */}
						<button
							type="button"
							className="hover:text-primary-ink underline underline-offset-4"
							data-qa-id="keyboard-shortcuts-show-all"
							onClick={() => void kernel.commands.execute("kilo.shell/show-shortcuts")}
						>
							full list
						</button>
						.
					</FieldDescription>
				</FieldContent>
				<div className="flex min-w-0 flex-col gap-6">
					{groups.map((group) => (
						<FieldSet
							key={group.name}
							aria-labelledby={`shortcut-group-${group.name}`}
							className="min-w-0"
						>
							<FieldContent>
								<FieldLegend id={`shortcut-group-${group.name}`} variant="label" className="mb-0">
									{group.name}
								</FieldLegend>
							</FieldContent>
							<ul className="border-border bg-card divide-border divide-y overflow-hidden rounded-lg border">
								{group.rows.map((row) => (
									<ShortcutRowItem
										key={row.key}
										row={row}
										overrides={overrides}
										resolution={resolution}
										conflict={row.commands.map((command) => takenBy.get(command.key)).find(Boolean)}
										keybindings={keybindings}
										platform={platform}
									/>
								))}
							</ul>
						</FieldSet>
					))}
				</div>
			</FieldSet>
		</div>
	);
}
