import { RotateCcwIcon, XIcon } from "lucide-react";
import { useEffect, useState, type KeyboardEvent } from "react";

import {
	chordFromKeyboardEvent,
	formatChord,
	hasCommandModifier,
	reservedChordAction,
	serializeChord,
	type KeyboardPlatform,
} from "@kilo-desktop/kernel";
import { useKernel } from "@kilo-desktop/kernel/web";
import { Button } from "@kilo-desktop/ui/components/button";
import { FieldContent, FieldLegend, FieldSet } from "@kilo-desktop/ui/components/field";
import { SettingsPageHeader } from "@kilo-desktop/ui/components/settings-page-header";
import { SummaryCard } from "@kilo-desktop/ui/components/summary-card";
import { cn } from "@kilo-desktop/ui/lib/utils";

import { groupShortcutCommands } from "../shared/shortcuts/shortcut-groups";
import { NumberKeysSettings } from "./NumberKeysSettings";
import { useNumberKeySeries } from "./number-keys";
import {
	chordLabels,
	keysLabel,
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
	chords,
	platform,
	onRecord,
	onTurnOff,
}: {
	readonly commandKey: string;
	readonly label: string;
	readonly chords: readonly string[];
	readonly platform: KeyboardPlatform;
	readonly onRecord: (chord: string) => void;
	readonly onTurnOff: () => void;
}) {
	const kernel = useKernel();
	const [recording, setRecording] = useState(false);
	const [rejection, setRejection] = useState<string | null>(null);
	const stopRecording = () => {
		setRecording(false);
		setRejection(null);
	};
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
			stopRecording();
			return;
		}
		const chord = chordFromKeyboardEvent(event.nativeEvent);
		// Plain or Shift-only keys would hijack typing, so a shortcut needs ⌘, ⌃, or ⌥.
		if (!chord || !hasCommandModifier(chord)) return;
		const reservedFor = reservedChordAction(chord, platform);
		if (reservedFor) {
			setRejection(
				`${keysLabel(formatChord(chord, platform), platform)} is reserved for ${reservedFor}.`,
			);
			return;
		}
		onRecord(serializeChord(chord));
		stopRecording();
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
				onBlur={stopRecording}
				onKeyDown={onKeyDown}
				className="focus-visible:ring-ring/50 flex h-full items-center gap-1.5 rounded-full px-2.5 outline-none focus-visible:ring-3"
			>
				{recording ? (
					<span
						role="status"
						className={cn("font-normal", rejection ? "text-warning" : "text-muted-foreground")}
						data-qa-id={rejection ? `shortcut-rejected-${commandKey}` : undefined}
					>
						{rejection ?? "Type the new keys…"}
					</span>
				) : chords.length > 0 ? (
					<ShortcutLabels labels={chordLabels(chords, platform)} />
				) : (
					<span className="text-muted-foreground font-normal">None</span>
				)}
			</button>
			{!recording && chords.length > 0 ? (
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

/** Settings → Shortcuts: every command with a shortcut, grouped, each one changeable. */
export function ShortcutsSettings() {
	const { commands, overrides, resolution, keybindings, platform } = useShortcuts();
	const titles = new Map<string, string>(
		commands.map((command) => [command.key, command.metadata.title]),
	);
	const takenBy = new Map<string, string>();
	for (const { commands: contenders } of resolution.conflicts) {
		const [winner, ...losers] = contenders;
		for (const loser of losers) takenBy.set(loser, titles.get(winner!) ?? winner!);
	}
	// App Navigation edits the 1–9 series as a whole, so their slots aren't listed one by one.
	const inSeries = new Set(useNumberKeySeries().flatMap((series) => [...series.digits.keys()]));
	const groups = groupShortcutCommands(commands.filter((command) => !inSeries.has(command.key)));
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
			<NumberKeysSettings />
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
							{group.commands.map((command) => {
								const overridden = command.key in overrides;
								const enabled = overrides[command.key] !== null;
								const chords = resolution.byCommand[command.key] ?? [];
								const conflict = takenBy.get(command.key);
								const label = command.metadata.title;
								return (
									// The row sets border-0, so the li carries the list's divider.
									<li key={command.key} data-qa-id={`shortcut-row-${command.key}`}>
										<SummaryCard.Row>
											<SummaryCard.Content>
												<SummaryCard.Title
													className={cn("truncate", !enabled && "text-muted-foreground")}
												>
													{label}
												</SummaryCard.Title>
												{conflict && enabled ? (
													<SummaryCard.Description
														className="text-warning"
														data-qa-id={`shortcut-conflict-${command.key}`}
													>
														Its shortcut is used by “{conflict}”.
													</SummaryCard.Description>
												) : null}
											</SummaryCard.Content>
											<SummaryCard.Actions className="gap-1">
												{/* Before the chip, so every chip lines up at the row's edge. */}
												{overridden ? (
													<Button
														variant="ghost"
														size="icon-xs"
														aria-label={`Reset ${label}`}
														data-qa-id={`shortcut-reset-${command.key}`}
														onClick={() =>
															void keybindings?.methods.reset({ command: command.key })
														}
													>
														<RotateCcwIcon aria-hidden />
													</Button>
												) : null}
												{command.metadata.handledLocally ? (
													<span
														className={cn(SHORTCUT_CHIP, "px-2.5")}
														data-qa-id={`shortcut-fixed-${command.key}`}
													>
														<ShortcutLabels labels={chordLabels(chords, platform)} />
													</span>
												) : (
													<ShortcutField
														commandKey={command.key}
														label={label}
														chords={enabled ? chords : []}
														platform={platform}
														onRecord={(chord) =>
															void keybindings?.methods.setOverride({
																command: command.key,
																chord,
															})
														}
														onTurnOff={() =>
															void keybindings?.methods.setOverride({
																command: command.key,
																chord: null,
															})
														}
													/>
												)}
											</SummaryCard.Actions>
										</SummaryCard.Row>
									</li>
								);
							})}
						</ul>
					</FieldSet>
				))}
			</div>
		</div>
	);
}
