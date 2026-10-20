import { useRef, useState, type ReactNode } from "react";

import { formatChord, type Command, type KeyboardPlatform } from "@kilo-desktop/feature-sdk";
import { Button } from "@kilo-desktop/ui/components/button";
import { Collapsible, CollapsibleContent } from "@kilo-desktop/ui/components/collapsible";
import { SummaryCard } from "@kilo-desktop/ui/components/summary-card";
import { Switch } from "@kilo-desktop/ui/components/switch";
import { ToggleGroup, ToggleGroupItem } from "@kilo-desktop/ui/components/toggle-group";
import { cn } from "@kilo-desktop/ui/lib/utils";

import {
	seriesOverrideKey,
	type KeybindingOverrides,
	type SeriesModifier,
} from "./effective-keybindings";
import { keysLabel, ShortcutChip } from "./ShortcutKeys";
import { setKeybindingOverrides } from "./keybinding-overrides";
import {
	collectNumberKeySeries,
	planModifierChange,
	planTurnOn,
	type NumberKeySeries,
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

function keyPrefix(modifier: SeriesModifier, platform: KeyboardPlatform): string {
	const option = optionsFor(platform).find((candidate) => candidate.value === modifier);
	if (!option) return "";
	return platform === "mac" ? option.symbol : `${option.name}+`;
}

type PreviewKind = "tabs" | "sessions";

const CARD_COPY: Record<PreviewKind, { title: string; noun: string }> = {
	tabs: { title: "Tabs", noun: "tab" },
	sessions: { title: "Sessions", noun: "session" },
};

function previewKind(group: string | undefined): PreviewKind {
	return group === "Sessions" ? "sessions" : "tabs";
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
	const lastPrefix = useRef(prefix);
	if (on) lastPrefix.current = prefix;
	const badge = (slot: number) => (
		<KeyBadge prefix={lastPrefix.current} slot={slot} visible={on} width={sizes.badge} />
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

function modifierKeys(modifier: Exclude<SeriesModifier, "none">, platform: KeyboardPlatform) {
	const chord = {
		code: "Digit1",
		meta: modifier === "meta",
		ctrl: modifier === "ctrl",
		alt: modifier === "alt",
		shift: false,
	};
	return formatChord(chord, platform).slice(0, -1);
}

function SeriesSwitch({
	series,
	onToggle,
}: {
	series: NumberKeySeries;
	onToggle: (on: boolean) => void;
}) {
	return (
		<Switch
			checked={series.current !== "none"}
			onCheckedChange={onToggle}
			aria-label={`Enable ${series.label}`}
			data-qa-id={`number-keys-toggle-${series.id}`}
		/>
	);
}

function SeriesSummary({
	series,
	platform,
}: {
	series: NumberKeySeries & { readonly group: string | undefined };
	platform: KeyboardPlatform;
}) {
	const modifier = series.current;
	const title = CARD_COPY[previewKind(series.group)].title;
	return (
		<li className="flex items-center gap-2" data-qa-id={`number-keys-summary-${series.id}`}>
			<span className="text-muted-foreground text-sm">{title}</span>
			{modifier === "none" ? (
				<span className="text-muted-foreground text-sm">Off</span>
			) : (
				<ShortcutChip
					labels={[`${keysLabel([...modifierKeys(modifier, platform), "1"], platform)}–9`]}
				/>
			)}
		</li>
	);
}

function ModifierSegments({
	label,
	seriesId,
	value,
	platform,
	onChange,
}: {
	label: string;
	seriesId: string;
	value: SeriesModifier;
	platform: KeyboardPlatform;
	onChange: (modifier: SeriesModifier) => void;
}) {
	const options = optionsFor(platform);
	const off = value === "none";
	return (
		<ToggleGroup
			aria-label={label}
			value={off ? [] : [value]}
			disabled={off}
			// A single-select group still lets the pressed item unpress; a series always has a modifier.
			onValueChange={(next) => {
				const picked = options.find((option) => option.value === next[0]);
				if (picked) onChange(picked.value);
			}}
			className="w-full"
			data-qa-id={`number-keys-${seriesId}`}
		>
			{options.map((option) => (
				<ToggleGroupItem
					key={option.value}
					value={option.value}
					className="flex-1"
					data-qa-id={`number-keys-${seriesId}-${option.value}`}
				>
					{option.symbol ? <span aria-hidden>{option.symbol}</span> : null}
					{option.name}
				</ToggleGroupItem>
			))}
		</ToggleGroup>
	);
}

export function NumberKeysSettings({
	commands,
	overrides,
	platform,
}: {
	commands: readonly Command[];
	overrides: KeybindingOverrides;
	platform: KeyboardPlatform;
}) {
	const series = collectNumberKeySeries(commands, overrides, platform);
	const [expanded, setExpanded] = useState(false);
	if (series.length === 0) return null;
	const customized = series.some((entry) => overrides[seriesOverrideKey(entry.id)] !== undefined);

	const change = (seriesId: string, modifier: SeriesModifier) => {
		setKeybindingOverrides(planModifierChange(series, seriesId, modifier).changes);
	};
	const toggle = (entry: NumberKeySeries, on: boolean) => {
		if (!on) return change(entry.id, "none");
		const choices = optionsFor(platform).flatMap((option) =>
			option.value === "none" ? [] : [option.value],
		);
		setKeybindingOverrides(planTurnOn(series, entry.id, choices).changes);
	};
	const restoreDefaults = () => {
		setKeybindingOverrides(
			Object.fromEntries(series.map((entry) => [seriesOverrideKey(entry.id), null])),
		);
	};

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
								<SeriesSummary key={entry.id} series={entry} platform={platform} />
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
						const kind = previewKind(entry.group);
						const prefix = keyPrefix(entry.current, platform);
						const titleId = `number-keys-${entry.id}-title`;
						return (
							<section
								key={entry.id}
								aria-labelledby={titleId}
								className="bg-muted/40 flex min-w-0 flex-col gap-3 rounded-lg p-3"
								data-qa-id={`number-keys-card-${entry.id}`}
							>
								<label className="-m-1 flex cursor-pointer items-center justify-between gap-3 p-1">
									<span id={titleId} className="text-sm font-medium">
										{CARD_COPY[kind].title}
									</span>
									<SeriesSwitch series={entry} onToggle={(on) => toggle(entry, on)} />
								</label>
								<NumberKeysPreview
									kind={kind}
									prefix={prefix}
									sizes={SIZES[platform === "mac" ? "mac" : "pc"]}
								/>
								<ModifierSegments
									label={`Modifier for ${entry.label}`}
									seriesId={entry.id}
									value={entry.current}
									platform={platform}
									onChange={(modifier) => change(entry.id, modifier)}
								/>
							</section>
						);
					})}
				</div>
			</CollapsibleContent>
		</Collapsible>
	);
}
