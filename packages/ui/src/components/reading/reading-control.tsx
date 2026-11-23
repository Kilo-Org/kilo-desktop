import { useState, type ReactNode } from "react";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { ArrowUpDownIcon, ScanLineIcon } from "lucide-react";

import { Kbd } from "@kilo-desktop/ui/components/kbd";
import { Slider } from "@kilo-desktop/ui/components/slider";
import { Switch } from "@kilo-desktop/ui/components/switch";
import { menuSurface } from "@kilo-desktop/ui/lib/menu-styles";
import {
	readingThemeName,
	readingThemeSwatches,
	resolveReadingTheme,
	type AppThemeSnapshot,
} from "@kilo-desktop/ui/lib/reading/reading-theme";
import {
	LINE_SPACING_COUNT,
	LINE_SPACING_LABELS,
	TEXT_SIZE_STEP_RANGE,
	type FocusMovesWith,
	type LineSpacing,
	type ReadingMode,
	type ReadingSettings,
	type ReadingSettingsPatch,
} from "@kilo-desktop/ui/lib/reading/settings";
import { cn } from "@kilo-desktop/ui/lib/utils";

import "./reading.css";
import { useFocusLayer, useFocusPortalContainer } from "./focus-context";
import {
	ReadingPresetDialogs,
	ReadingPresetsHeader,
	type ReadingPresetsControl,
	type ReadingPresetsDialog,
} from "./reading-presets";

export type ReadingSettingName =
	| "theme"
	| "mode"
	| "text-size"
	| "line-spacing"
	| "moves-with"
	| "dimming"
	| "reset";

export interface ReadingControlProps {
	readonly settings: ReadingSettings;
	readonly onChange: (patch: ReadingSettingsPatch, setting: ReadingSettingName) => void;
	/**
	 * The Dimming slider's value while it is dragged, so Focus re-dims as it
	 * moves; `onChange` saves it on release.
	 */
	readonly onDimmingInput?: (dimming: number) => void;
	readonly onReset: () => void;
	/** The app's effective theme: what Auto and "no reading theme" mean. */
	readonly appTheme: AppThemeSnapshot;
	/** The surface's text size at step 0, shown in the stepper with the step added. */
	readonly baseSize: number;
	/** Whether the control sits in Focus (where the Focus switch turns Focus off). */
	readonly inFocus: boolean;
	readonly focusOn: boolean;
	readonly onFocusChange: (on: boolean) => void;
	/** Hides the Focus row where Focus is not available (a pop-out window). */
	readonly focusAvailable?: boolean;
	/** The Focus shortcut as shown to the person, e.g. "⌘⇧F". */
	readonly focusShortcut?: string;
	readonly footnote: string;
	readonly onOpenChange?: (open: boolean) => void;
	/** Saved reading presets; without them the header has only Reset. */
	readonly presets?: ReadingPresetsControl;
	readonly className?: string;
	/** Prefix for `data-qa-id`s, e.g. "chat-reading". */
	readonly qaId?: string;
}

const MODE_OPTIONS: readonly { value: ReadingMode; label: string }[] = [
	{ value: "auto", label: "Auto" },
	{ value: "light", label: "Light" },
	{ value: "dark", label: "Dark" },
];

const MOVES_WITH_OPTIONS: readonly SegmentedOption<FocusMovesWith>[] = [
	{ value: "scroll", label: "Scrolling" },
	{ value: "pointer", label: "Pointer" },
	{
		value: "keys",
		label: (
			<>
				<ArrowUpDownIcon aria-hidden="true" className="size-3" />
				Keys
			</>
		),
		name: "Arrow keys",
	},
];

/**
 * The "Aa" reading control: a 36px round trigger and a popover (304px, 12px
 * radius, 14px padding) above it, right-aligned. Theme, text size and line
 * spacing apply to reading surfaces only; Focus options show while Focus is
 * on. Inside the Focus reader its popover portals into the reader's popup
 * layer, keeping the app's theme and size, and Escape closes it before Focus.
 * Given `presets`, the header also offers saved reading presets (see
 * reading-presets.tsx).
 */
export function ReadingControl(props: ReadingControlProps) {
	const { className, qaId = "reading", onOpenChange, presets } = props;
	const [open, setOpen] = useState(false);
	const [dialog, setDialog] = useState<ReadingPresetsDialog>(null);
	const container = useFocusPortalContainer();
	useFocusLayer(open);
	const change = (next: boolean) => {
		setOpen(next);
		onOpenChange?.(next);
	};
	// A preset dialog stands in for the popover while it is open and hands back
	// to it, so to the host the popover never closed.
	const openDialog = (next: Exclude<ReadingPresetsDialog, null>) => {
		setOpen(false);
		setDialog(next);
	};
	const closeDialog = () => {
		setDialog(null);
		setOpen(true);
	};
	return (
		<>
			<PopoverPrimitive.Root open={open} onOpenChange={change}>
				<PopoverPrimitive.Trigger
					aria-label="Reading settings"
					data-qa-id={`${qaId}-trigger`}
					className={cn(
						"bg-popover text-muted-foreground hover:text-foreground border-border-subtle inline-flex size-9 shrink-0 items-center justify-center rounded-full border font-sans font-semibold text-[15px] leading-none shadow-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 data-popup-open:bg-muted data-popup-open:text-foreground data-popup-open:shadow-inner",
						className,
					)}
				>
					<span aria-hidden="true">
						A<span className="text-[11px]">a</span>
					</span>
				</PopoverPrimitive.Trigger>
				<PopoverPrimitive.Portal container={container ?? undefined}>
					<PopoverPrimitive.Positioner
						side="top"
						align="end"
						sideOffset={8}
						className="isolate z-50"
					>
						<PopoverPrimitive.Popup
							data-qa-id={`${qaId}-popover`}
							className={cn(
								"flex w-[304px] origin-(--transform-origin) flex-col gap-3 rounded-[12px] p-[14px] text-[13px] outline-hidden",
								menuSurface,
								"data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
							)}
						>
							<ReadingPanel
								{...props}
								onOpenPresetsDialog={openDialog}
								onFocusChange={(on) => {
									// Entering Focus covers this control's surface; its popover goes with it.
									if (on && !props.inFocus) change(false);
									props.onFocusChange(on);
								}}
							/>
						</PopoverPrimitive.Popup>
					</PopoverPrimitive.Positioner>
				</PopoverPrimitive.Portal>
			</PopoverPrimitive.Root>
			{presets ? (
				<ReadingPresetDialogs
					presets={presets}
					settings={props.settings}
					appTheme={props.appTheme}
					baseSize={props.baseSize}
					dialog={dialog}
					onClose={closeDialog}
					qaId={qaId}
				/>
			) : null}
		</>
	);
}

function ReadingPanel({
	settings,
	onChange,
	onDimmingInput,
	onReset,
	appTheme,
	baseSize,
	focusOn,
	onFocusChange,
	focusAvailable = true,
	focusShortcut,
	footnote,
	presets,
	onOpenPresetsDialog,
	qaId = "reading",
}: ReadingControlProps & {
	onOpenPresetsDialog: (dialog: Exclude<ReadingPresetsDialog, null>) => void;
}) {
	const resolved = resolveReadingTheme(settings, appTheme);
	const swatches = readingThemeSwatches(resolved.mode);
	const size = baseSize + settings.textSizeStep;
	return (
		<>
			<div className="flex items-center justify-between gap-2">
				<PopoverPrimitive.Title className="text-foreground text-[13px] font-semibold">
					Reading
				</PopoverPrimitive.Title>
				<div className="flex min-w-0 items-center gap-1.5">
					{presets ? (
						<ReadingPresetsHeader
							presets={presets}
							appTheme={appTheme}
							onOpenDialog={onOpenPresetsDialog}
							qaId={qaId}
						/>
					) : null}
					<button
						type="button"
						onClick={onReset}
						data-qa-id={`${qaId}-reset`}
						className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 rounded px-1 text-xs outline-none focus-visible:ring-2"
					>
						Reset
					</button>
				</div>
			</div>

			<section aria-label="Theme" className="flex flex-col gap-2">
				<div className="flex items-center justify-between gap-2">
					<span className="text-muted-foreground text-xs">
						Theme{" "}
						<span className="text-foreground" data-qa-id={`${qaId}-theme-name`}>
							{readingThemeName(resolved.themeId)}
						</span>
					</span>
					<Segmented
						label="Theme mode"
						options={MODE_OPTIONS}
						value={settings.mode}
						onChange={(mode) => onChange({ mode }, "mode")}
						qaId={`${qaId}-mode`}
					/>
				</div>
				<div role="radiogroup" aria-label="Reading theme" className="flex justify-between">
					{swatches.map((swatch) => {
						const selected = swatch.id === resolved.themeId;
						return (
							<button
								key={swatch.id}
								type="button"
								role="radio"
								aria-checked={selected}
								aria-label={swatch.name}
								title={swatch.name}
								data-qa-id={`${qaId}-theme-${swatch.id}`}
								onClick={() => onChange({ themeId: swatch.id }, "theme")}
								className={cn(
									"border-foreground/15 flex size-7 items-center justify-center rounded-full border outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
									selected && "ring-foreground ring-offset-popover ring-[1.5px] ring-offset-2",
								)}
								style={{ backgroundColor: swatch.background }}
							>
								<span
									aria-hidden="true"
									className="size-2 rounded-full"
									style={{ backgroundColor: swatch.accent }}
								/>
							</button>
						);
					})}
				</div>
			</section>

			{/* A slider with its size beside it, like Settings → Appearance's text sizes. */}
			<Row label="Text size">
				<div className="flex w-36 items-center gap-2">
					<Slider
						aria-label="Text size"
						min={baseSize + TEXT_SIZE_STEP_RANGE.min}
						max={baseSize + TEXT_SIZE_STEP_RANGE.max}
						step={1}
						value={size}
						onValueChange={(value) => {
							const next = (Array.isArray(value) ? value[0]! : value) - baseSize;
							if (next !== settings.textSizeStep) onChange({ textSizeStep: next }, "text-size");
						}}
						data-qa-id={`${qaId}-size-slider`}
					/>
					<span
						className="text-muted-foreground w-9 text-right text-xs tabular-nums"
						data-qa-id={`${qaId}-size`}
					>
						{size}px
					</span>
				</div>
			</Row>

			<Row label="Line spacing">
				<Segmented
					label="Line spacing"
					options={Array.from({ length: LINE_SPACING_COUNT }, (_, index) => ({
						value: index as LineSpacing,
						label: <SpacingIcon spacing={index as LineSpacing} />,
						name: LINE_SPACING_LABELS[index]!,
					}))}
					value={settings.lineSpacing}
					onChange={(lineSpacing) => onChange({ lineSpacing }, "line-spacing")}
					qaId={`${qaId}-spacing`}
				/>
			</Row>

			{focusAvailable ? (
				<>
					<hr className="bg-border -mx-[14px] h-px border-0" />
					<label className="flex items-center gap-2">
						<ScanLineIcon aria-hidden="true" className="text-muted-foreground size-4" />
						<span className="text-foreground flex-1 font-medium">Focus</span>
						{focusShortcut ? <Kbd>{focusShortcut}</Kbd> : null}
						<Switch
							checked={focusOn}
							onCheckedChange={(checked) => onFocusChange(checked)}
							aria-label="Focus"
							data-qa-id={`${qaId}-focus-switch`}
						/>
					</label>
					{focusOn ? (
						<FocusOptions
							settings={settings}
							onChange={onChange}
							{...(onDimmingInput ? { onDimmingInput } : {})}
							qaId={qaId}
							footnote={footnote}
						/>
					) : null}
				</>
			) : null}
		</>
	);
}

function FocusOptions({
	settings,
	onChange,
	onDimmingInput,
	qaId,
	footnote,
}: Pick<ReadingControlProps, "settings" | "onChange" | "onDimmingInput" | "footnote"> & {
	qaId: string;
}) {
	// The slider's own value while dragged; a newly saved value replaces it.
	const [dimming, setDimming] = useState(settings.focus.dimming);
	const [savedDimming, setSavedDimming] = useState(settings.focus.dimming);
	if (savedDimming !== settings.focus.dimming) {
		setSavedDimming(settings.focus.dimming);
		setDimming(settings.focus.dimming);
	}
	return (
		<div className="flex flex-col gap-3" data-qa-id={`${qaId}-focus-options`}>
			<Row label="Moves with">
				<Segmented
					label="Moves with"
					options={MOVES_WITH_OPTIONS}
					value={settings.focus.movesWith}
					onChange={(movesWith) => onChange({ focus: { movesWith } }, "moves-with")}
					qaId={`${qaId}-moves-with`}
				/>
			</Row>
			<Row label="Dimming">
				<div className="flex w-36 items-center gap-2">
					<Slider
						aria-label="Dimming"
						min={0}
						max={100}
						step={5}
						value={dimming}
						onValueChange={(value) => {
							const next = Array.isArray(value) ? value[0]! : value;
							setDimming(next);
							onDimmingInput?.(next);
						}}
						onValueCommitted={(value) =>
							onChange({ focus: { dimming: Array.isArray(value) ? value[0]! : value } }, "dimming")
						}
						data-qa-id={`${qaId}-dimming`}
					/>
					<span
						className="text-muted-foreground w-9 text-right text-xs tabular-nums"
						data-qa-id={`${qaId}-dimming-value`}
					>
						{dimming}%
					</span>
				</div>
			</Row>
			<p className="text-muted-foreground text-[11px] leading-snug" data-qa-id={`${qaId}-footnote`}>
				{footnote}
			</p>
		</div>
	);
}

function Row({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="flex items-center justify-between gap-3">
			<span className="text-muted-foreground min-w-0 text-xs whitespace-nowrap">{label}</span>
			{children}
		</div>
	);
}

interface SegmentedOption<T> {
	readonly value: T;
	readonly label: ReactNode;
	/** Accessible name when the label is an icon. */
	readonly name?: string;
}

function Segmented<T extends string | number>({
	label,
	options,
	value,
	onChange,
	qaId,
}: {
	label: string;
	options: readonly SegmentedOption<T>[];
	value: T;
	onChange: (value: T) => void;
	qaId: string;
}) {
	return (
		<div
			role="radiogroup"
			aria-label={label}
			className="bg-muted flex shrink-0 items-center gap-0.5 rounded-md p-0.5"
			data-qa-id={qaId}
		>
			{options.map((option) => {
				const checked = option.value === value;
				return (
					<button
						key={String(option.value)}
						type="button"
						role="radio"
						aria-checked={checked}
						aria-label={option.name}
						data-qa-id={`${qaId}-${option.value}`}
						onClick={() => onChange(option.value)}
						className={cn(
							"text-muted-foreground hover:text-foreground flex h-6 min-w-7 items-center justify-center gap-1 rounded-[5px] px-2 text-xs leading-none whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
							checked && "bg-popover text-foreground shadow-sm",
						)}
					>
						{option.label}
					</button>
				);
			})}
		</div>
	);
}

/** Three lines, further apart for each looser option. */
function SpacingIcon({ spacing }: { spacing: LineSpacing }) {
	const gap = 2.5 + spacing;
	const top = 8 - gap;
	return (
		<svg aria-hidden="true" viewBox="0 0 16 16" className="size-3.5">
			{[0, 1, 2].map((line) => (
				<line
					key={line}
					x1="2"
					x2="14"
					y1={top + line * gap}
					y2={top + line * gap}
					stroke="currentColor"
					strokeWidth="1.4"
					strokeLinecap="round"
				/>
			))}
		</svg>
	);
}
