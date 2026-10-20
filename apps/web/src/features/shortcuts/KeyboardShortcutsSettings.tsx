import { RotateCcwIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";

import {
	chordFromKeyboardEvent,
	detectKeyboardPlatform,
	formatChord,
	hasCommandModifier,
	reservedChordAction,
	serializeChord,
	type KeyboardPlatform,
} from "@kilo-desktop/feature-sdk";
import { SettingsPageHeader, useFeatureSystem } from "@kilo-desktop/sdk-react";
import { Button } from "@kilo-desktop/ui/components/button";
import {
	FieldContent,
	FieldDescription,
	FieldLegend,
	FieldSet,
} from "@kilo-desktop/ui/components/field";
import { SummaryCard } from "@kilo-desktop/ui/components/summary-card";
import { cn } from "@kilo-desktop/ui/lib/utils";

import {
	computeEffectiveKeybindings,
	isConfigurable,
	type KeybindingOverride,
} from "./effective-keybindings";
import {
	resetKeybindingOverrides,
	setKeybindingOverride,
	useKeybindingOverrides,
} from "./keybinding-overrides";
import { useListedCommands } from "./known-commands";
import { groupShortcutCommands } from "./shortcut-groups";
import { SHELL_FEATURE_ID } from "./shell-feature";
import { setShortcutRecording } from "./shortcut-recording";
import { NumberKeysSettings } from "./NumberKeysSettings";
import { chordLabels, keysLabel, SHORTCUT_CHIP, ShortcutLabels } from "./ShortcutKeys";

/**
 * The shortcut as one chip: clicking it records new keys, and hovering or
 * focusing it reveals × to turn the shortcut off.
 */
function ShortcutField({
	commandId,
	label,
	chords,
	platform,
	onRecord,
	onTurnOff,
}: {
	commandId: string;
	label: string;
	chords: readonly string[];
	platform: KeyboardPlatform;
	onRecord: (chord: string) => void;
	onTurnOff: () => void;
}) {
	const [recording, setRecording] = useState(false);
	const [rejection, setRejection] = useState<string | null>(null);
	useEffect(() => {
		if (!recording) setRejection(null);
	}, [recording]);
	useEffect(() => {
		if (!recording) return;
		setShortcutRecording(true);
		return () => setShortcutRecording(false);
	}, [recording]);

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
		const reservedFor = reservedChordAction(chord, platform);
		if (reservedFor) {
			setRejection(
				`${keysLabel(formatChord(chord, platform), platform)} is reserved for ${reservedFor}.`,
			);
			return;
		}
		onRecord(serializeChord(chord));
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
				data-qa-id={`shortcut-recorder-${commandId}`}
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
						data-qa-id={rejection ? `shortcut-rejected-${commandId}` : undefined}
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
					data-qa-id={`shortcut-turn-off-${commandId}`}
					onClick={onTurnOff}
					className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 grid h-4.5 w-0 shrink-0 place-items-center overflow-hidden rounded-full opacity-0 transition-[width,opacity,margin] duration-150 ease-out outline-none group-focus-within/field:mr-1.25 group-focus-within/field:-ml-1.25 group-focus-within/field:w-4.5 group-focus-within/field:opacity-100 group-hover/field:mr-1.25 group-hover/field:-ml-1.25 group-hover/field:w-4.5 group-hover/field:opacity-100 focus-visible:ring-3"
				>
					<XIcon className="size-3" aria-hidden />
				</button>
			) : null}
		</div>
	);
}

export function KeyboardShortcutsSettings() {
	const { commandRegistry } = useFeatureSystem().services;
	const commands = useListedCommands();
	const overrides = useKeybindingOverrides();
	const platform = useMemo(detectKeyboardPlatform, []);
	const effective = useMemo(
		() => computeEffectiveKeybindings(commands, overrides, platform),
		[commands, overrides, platform],
	);
	const labels = useMemo(
		() => new Map(commands.map((command) => [command.id, command.label])),
		[commands],
	);
	const takenBy = useMemo(() => {
		const map = new Map<string, string>();
		for (const { commandIds } of effective.conflicts) {
			const [winner, ...losers] = commandIds;
			for (const loser of losers) map.set(loser, labels.get(winner!) ?? winner!);
		}
		return map;
	}, [effective.conflicts, labels]);
	// Only shortcuts you can change; numbered navigation has its own card and the rest are in the ⌘/ list.
	const groups = groupShortcutCommands(commands)
		.map((group) => ({
			...group,
			rows: group.rows.filter(
				(row) => row.commands.length === 1 && isConfigurable(row.commands[0]!),
			),
		}))
		.filter((group) => group.rows.length > 0);
	const hasOverrides = Object.keys(overrides).length > 0;

	const update = (commandId: string, override: KeybindingOverride | null) =>
		setKeybindingOverride(commandId, override);

	return (
		<div className="flex min-w-0 flex-col gap-6" data-qa-id="keyboard-shortcuts-settings">
			<SettingsPageHeader
				actions={
					<Button
						variant="outline"
						size="sm"
						disabled={!hasOverrides}
						onClick={resetKeybindingOverrides}
						data-qa-id="keyboard-shortcuts-reset-all"
					>
						<RotateCcwIcon aria-hidden />
						Reset all
					</Button>
				}
			/>
			<NumberKeysSettings commands={commands} overrides={overrides} platform={platform} />
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
							onClick={() => void commandRegistry.execute(`${SHELL_FEATURE_ID}.show-shortcuts`)}
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
								{group.rows.map((row) => {
									const command = row.commands[0]!;
									const override = overrides[command.id];
									const enabled = override?.disabled !== true;
									const chords = effective.byCommand[command.id] ?? [];
									const conflict = takenBy.get(command.id);
									return (
										// The row sets border-0, so the li carries the list's divider.
										<li key={row.key} data-qa-id={`shortcut-row-${command.id}`}>
											<SummaryCard.Row>
												<SummaryCard.Content>
													<SummaryCard.Title
														className={cn("truncate", !enabled && "text-muted-foreground")}
													>
														{command.label}
													</SummaryCard.Title>
													{conflict && enabled ? (
														<SummaryCard.Description
															className="text-warning"
															data-qa-id={`shortcut-conflict-${command.id}`}
														>
															Its shortcut is used by “{conflict}”.
														</SummaryCard.Description>
													) : null}
												</SummaryCard.Content>
												<SummaryCard.Actions className="gap-1">
													<ShortcutField
														commandId={command.id}
														label={command.label}
														chords={enabled ? chords : []}
														platform={platform}
														onRecord={(chord) => update(command.id, { chords: [chord] })}
														onTurnOff={() => update(command.id, { disabled: true })}
													/>
													<span className="flex size-6 shrink-0 items-center justify-center">
														{override ? (
															<Button
																variant="ghost"
																size="icon-xs"
																aria-label={`Reset ${command.label}`}
																data-qa-id={`shortcut-reset-${command.id}`}
																onClick={() => update(command.id, null)}
															>
																<RotateCcwIcon aria-hidden />
															</Button>
														) : null}
													</span>
												</SummaryCard.Actions>
											</SummaryCard.Row>
										</li>
									);
								})}
							</ul>
						</FieldSet>
					))}
				</div>
			</FieldSet>
		</div>
	);
}
