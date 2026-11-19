import { useState, type ReactNode } from "react";

import { formatChord, type KeyboardPlatform } from "@kilo-desktop/kernel";
import { Button } from "@kilo-desktop/ui/components/button";
import { Collapsible, CollapsibleContent } from "@kilo-desktop/ui/components/collapsible";
import { SummaryCard } from "@kilo-desktop/ui/components/summary-card";
import { Switch } from "@kilo-desktop/ui/components/switch";
import { ToggleGroup, ToggleGroupItem } from "@kilo-desktop/ui/components/toggle-group";
import { cn } from "@kilo-desktop/ui/lib/utils";

import { groupShortcutCommands } from "../shared/shortcuts/shortcut-groups";
import { keysLabel, ShortcutChip } from "../shared/shortcuts/ShortcutKeys";
import { useShortcuts } from "../shared/shortcuts/use-shortcuts";
import {
	collectNumberKeySeries,
	planModifierChange,
	planTurnOn,
	type NumberKeySeries,
	type OverridePlan,
	type SeriesModifier,
} from "./number-keys";

interface ModifierOption {
	readonly value: SeriesModifier;
	readonly symbol: string;
	readonly name: string;
}

const MAC_OPTIONS: readonly ModifierOption[] = [
	{ value: "meta", symbol: "⌘", name: "Command" },
	{ value: "ctrl", symbol: "⌃", name: "Control" },
	{ value: "alt", symbol: "⌥", name: "Option" },
];

const PC_OPTIONS: readonly ModifierOption[] = [
	{ value: "ctrl", symbol: "", name: "Ctrl" },
	{ value: "alt", symbol: "", name: "Alt" },
];

function optionsFor(platform: KeyboardPlatform): readonly ModifierOption[] {
	return platform === "mac" ? MAC_OPTIONS : PC_OPTIONS;
}

function keyPrefix(modifier: NumberKeySeries["current"], platform: KeyboardPlatform): string {
	const option = optionsFor(platform).find((candidate) => candidate.value === modifier);
	if (!option) return "";
	return platform === "mac" ? option.symbol : `${option.name}+`;
}

type PreviewKind = "tabs" | "sessions";

function previewKind(category: string): PreviewKind {
	return category === "Sessions" ? "sessions" : "tabs";
}

const ACTIVE_ITEM = "bg-foreground/[0.06]";
const PLACEHOLDER_TEXT = "bg-muted-foreground/25 h-1.5 rounded-full";
const PREVIEW_SLOTS = [1, 2] as const;

// "Ctrl+1" spells the key out, so it needs a wider badge (and tab) than "⌘1".
const SIZES = {
	mac: { badge: "w-[26px]", tab: "w-[4.25rem]" },
	pc: { badge: "w-[42px]", tab: "w-[5.5rem]" },
} as const;

type PreviewSizes = (typeof SIZES)[keyof typeof SIZES];

function KeyBadge({
	prefix,
	slot,
	visible,
	width,
}: {
	prefix: string;
	slot: number;
	visible: boolean;
	width: string;
}) {
	return (
		<span
			aria-hidden
			className={cn(
				width,
				"bg-foreground/10 text-foreground inline-flex h-4 shrink-0 items-center justify-center gap-px rounded-[4px] text-[10px] leading-none font-medium tabular-nums transition-opacity duration-150 motion-reduce:transition-none",
				visible ? "opacity-100" : "opacity-0",
			)}
		>
			<span className="flex items-center">{prefix}</span>
			<span>{slot}</span>
		</span>
	);
}

function Dots({ vertical }: { vertical?: boolean }) {
	return (
		<span className={cn("flex items-center gap-0.5", vertical && "flex-col")}>
			<span className="bg-muted-foreground/60 size-0.5 rounded-full" />
			<span className="bg-muted-foreground/60 size-0.5 rounded-full" />
			<span className="bg-muted-foreground/60 size-0.5 rounded-full" />
		</span>
	);
}

// Reveal is animated off the height var Base UI publishes while the panel transitions.
const PANEL_CLASSNAME =
	"h-[var(--collapsible-panel-height)] overflow-hidden transition-[height] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] data-ending-style:h-0 data-starting-style:h-0 [&[hidden]:not([hidden='until-found'])]:hidden motion-reduce:transition-none";

function PreviewTab({ slot, badge, width }: { slot: number; badge: ReactNode; width: string }) {
	return (
		<span
			className={cn(
				width,
				"flex shrink-0 items-center gap-1.5 px-1",
				slot === 1 ? cn(ACTIVE_ITEM, "h-7 rounded-t-[5px] pb-1") : "mb-1 h-6",
			)}
		>
			{badge}
			<span className={cn(PLACEHOLDER_TEXT, "flex-1")} />
		</span>
	);
}

function PreviewSession({ slot, badge }: { slot: number; badge: ReactNode }) {
	return (
		<span
			className={cn(
				"flex h-6 items-center gap-2 rounded-[5px] pr-1 pl-1.5",
				slot === 1 && ACTIVE_ITEM,
			)}
		>
			<span className="bg-muted-foreground/30 size-1.5 shrink-0 rounded-full" />
			<span className={cn(PLACEHOLDER_TEXT, slot === 2 ? "w-20" : "w-28")} />
			<span className="ml-auto flex">{badge}</span>
		</span>
	);
}

function NumberKeysPreview({
	kind,
	prefix,
	sizes,
}: {
	kind: PreviewKind;
	prefix: string;
	sizes: PreviewSizes;
}) {
	const on = prefix !== "";
	// Keep the last prefix so a badge fades out whole instead of losing its symbol first.
	const [lastPrefix, setLastPrefix] = useState(prefix);
	if (on && prefix !== lastPrefix) setLastPrefix(prefix);
	const badge = (slot: number) => (
		<KeyBadge prefix={lastPrefix} slot={slot} visible={on} width={sizes.badge} />
	);
	return (
		<div
			aria-hidden
			className={cn(
				"bg-background border-border flex h-[6.75rem] flex-col overflow-hidden rounded-md border p-1.5 transition-opacity duration-150 motion-reduce:transition-none",
				!on && "opacity-50",
			)}
			data-qa-id={`number-keys-preview-${kind}`}
		>
			{kind === "tabs" ? (
				<>
					<div className="flex items-end gap-1">
						{PREVIEW_SLOTS.map((slot) => (
							<PreviewTab key={slot} slot={slot} badge={badge(slot)} width={sizes.tab} />
						))}
						<span className="mb-1 flex h-6 items-center px-0.5">
							<Dots />
						</span>
						<PreviewTab slot={9} badge={badge(9)} width={sizes.tab} />
					</div>
					<div className={cn(ACTIVE_ITEM, "flex-1 rounded-[5px] rounded-tl-none")} />
				</>
			) : (
				<div className="flex flex-col gap-1">
					{PREVIEW_SLOTS.map((slot) => (
						<PreviewSession key={slot} slot={slot} badge={badge(slot)} />
					))}
					<span className="flex h-2.5 justify-end pr-1">
						<span className={cn(sizes.badge, "flex justify-center")}>
							<Dots vertical />
						</span>
					</span>
					<PreviewSession slot={9} badge={badge(9)} />
				</div>
			)}
		</div>
	);
}

function modifierKeys(modifier: SeriesModifier, platform: KeyboardPlatform) {
	const chord = {
		code: "Digit1",
		meta: modifier === "meta",
		ctrl: modifier === "ctrl",
		alt: modifier === "alt",
		shift: false,
	};
	return formatChord(chord, platform).slice(0, -1);
}

/** "⌘1–9" ("Ctrl+1–9" elsewhere) for a set on one modifier; null when it is off or custom. */
export function seriesRangeLabel(
	series: NumberKeySeries,
	platform: KeyboardPlatform,
): string | null {
	const modifier = series.current;
	if (modifier === "none" || modifier === "custom") return null;
	return `${keysLabel([...modifierKeys(modifier, platform), "1"], platform)}–9`;
}

const qaId = (series: NumberKeySeries) => series.category.toLowerCase();

function SeriesSummary({
	series,
	platform,
}: {
	series: NumberKeySeries;
	platform: KeyboardPlatform;
}) {
	const modifier = series.current;
	const label = seriesRangeLabel(series, platform);
	return (
		<li className="flex items-center gap-2" data-qa-id={`number-keys-summary-${qaId(series)}`}>
			<span className="text-muted-foreground text-sm">{series.category}</span>
			{label ? (
				<ShortcutChip labels={[label]} />
			) : (
				<span className="text-muted-foreground text-sm">
					{modifier === "none" ? "Off" : "Custom"}
				</span>
			)}
		</li>
	);
}

function ModifierSegments({
	series,
	platform,
	onChange,
}: {
	series: NumberKeySeries;
	platform: KeyboardPlatform;
	onChange: (modifier: SeriesModifier) => void;
}) {
	const options = optionsFor(platform);
	const value = series.current;
	const picked = value === "none" || value === "custom" ? [] : [value];
	return (
		<ToggleGroup
			aria-label={`Modifier for ${series.category} 1–9`}
			value={picked}
			disabled={value === "none"}
			// A single-select group still lets the pressed item unpress; a series always has a modifier.
			onValueChange={(next) => {
				const option = options.find((candidate) => candidate.value === next[0]);
				if (option) onChange(option.value);
			}}
			className="w-full"
			data-qa-id={`number-keys-${qaId(series)}`}
		>
			{options.map((option) => (
				<ToggleGroupItem
					key={option.value}
					value={option.value}
					className="flex-1"
					data-qa-id={`number-keys-${qaId(series)}-${option.value}`}
				>
					{option.symbol ? <span aria-hidden>{option.symbol}</span> : null}
					{option.name}
				</ToggleGroupItem>
			))}
		</ToggleGroup>
	);
}

/** The 1–9 series, in the list's group order so Tabs comes before Sessions. */
export function useNumberKeySeries(): NumberKeySeries[] {
	const { commands, overrides, platform } = useShortcuts();
	return collectNumberKeySeries(
		groupShortcutCommands(commands)
			.flatMap((group) => group.commands)
			.map((command) => ({
				key: command.key,
				scoped: command.when !== undefined,
				metadata: command.metadata,
			})),
		overrides,
		platform,
	);
}

/**
 * App Navigation: picks the modifier each "go to item 1–9" series jumps with
 * (⌘ for tabs, ⌃ for sessions). A pick rewrites the series' per-slot
 * overrides, so the chips, the list below and the ⌘/ list follow it.
 */
export function NumberKeysSettings() {
	const { overrides, keybindings, platform } = useShortcuts();
	const [expanded, setExpanded] = useState(false);
	const series = useNumberKeySeries();
	if (series.length === 0) return null;
	const customized = series.some((entry) => entry.commands.some((key) => key in overrides));

	// One update, so the previews never see a half-moved series (or a half-done swap).
	const apply = (plan: OverridePlan) => {
		const set: Record<string, string | null> = {};
		const reset: string[] = [];
		for (const [command, chord] of Object.entries(plan)) {
			if (chord === undefined) reset.push(command);
			else set[command] = chord;
		}
		void keybindings?.methods.update({ set, reset });
	};
	const choices = optionsFor(platform).map((option) => option.value);
	const toggle = (entry: NumberKeySeries, on: boolean) =>
		apply(
			on
				? planTurnOn(series, entry.category, choices)
				: planModifierChange(series, entry.category, "none", choices),
		);
	const restoreDefaults = () =>
		apply(
			Object.fromEntries(series.flatMap((entry) => entry.commands.map((key) => [key, undefined]))),
		);

	return (
		<Collapsible
			open={expanded}
			onOpenChange={setExpanded}
			aria-labelledby="number-keys-heading"
			className="border-border bg-card min-w-0 overflow-hidden rounded-lg border"
			data-qa-id="number-keys-settings"
		>
			<SummaryCard.Row>
				<SummaryCard.Trigger type="button" aria-label="Customize app navigation">
					<SummaryCard.Content>
						<SummaryCard.Title id="number-keys-heading">App Navigation</SummaryCard.Title>
					</SummaryCard.Content>
				</SummaryCard.Trigger>
				<SummaryCard.Actions>
					{expanded ? (
						customized ? (
							<Button
								variant="ghost"
								size="sm"
								onClick={restoreDefaults}
								data-qa-id="number-keys-restore-defaults"
							>
								Restore defaults
							</Button>
						) : null
					) : (
						<ul className="flex items-center gap-4" data-qa-id="number-keys-summary">
							{series.map((entry) => (
								<SeriesSummary key={entry.category} series={entry} platform={platform} />
							))}
						</ul>
					)}
					<SummaryCard.Toggle
						label="Customize app navigation"
						open={expanded}
						data-qa-id="number-keys-customize"
					/>
				</SummaryCard.Actions>
			</SummaryCard.Row>
			<CollapsibleContent className={PANEL_CLASSNAME}>
				<div className="border-border grid grid-cols-1 gap-4 border-t p-4 sm:grid-cols-2">
					{series.map((entry) => {
						const titleId = `number-keys-${qaId(entry)}-title`;
						return (
							<section
								key={entry.category}
								aria-labelledby={titleId}
								className="bg-muted/40 flex min-w-0 flex-col gap-3 rounded-lg p-3"
								data-qa-id={`number-keys-card-${qaId(entry)}`}
							>
								<label className="-m-1 flex cursor-pointer items-center justify-between gap-3 p-1">
									<span id={titleId} className="text-sm font-medium">
										{entry.category}
									</span>
									<Switch
										checked={entry.current !== "none"}
										onCheckedChange={(on) => toggle(entry, on)}
										aria-label={`Enable ${entry.category} 1–9`}
										data-qa-id={`number-keys-toggle-${qaId(entry)}`}
									/>
								</label>
								<NumberKeysPreview
									kind={previewKind(entry.category)}
									prefix={keyPrefix(entry.current, platform)}
									sizes={SIZES[platform === "mac" ? "mac" : "pc"]}
								/>
								<ModifierSegments
									series={entry}
									platform={platform}
									onChange={(modifier) =>
										apply(planModifierChange(series, entry.category, modifier, choices))
									}
								/>
							</section>
						);
					})}
				</div>
			</CollapsibleContent>
		</Collapsible>
	);
}
