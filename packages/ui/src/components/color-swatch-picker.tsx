import { useRef, type ComponentProps } from "react";
import { PlusIcon } from "lucide-react";

import { ToggleGroup, ToggleGroupItem } from "@kilo-desktop/ui/components/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@kilo-desktop/ui/components/tooltip";
import { cn } from "@kilo-desktop/ui/lib/utils";

type ColorSwatch = {
	value: string;
	/** Colour name: the tooltip and accessible name. */
	label: string;
	/** CSS colour. Omit for a text option such as "Theme". */
	color?: string;
	qaId?: string;
};

type CustomColorOption = {
	/**
	 * The custom colour shown on the custom swatch (selected when it equals
	 * `value`); keep the last one while a preset is chosen so it can be re-picked.
	 */
	color: string | null;
	/** Seed for the system colour picker before any custom colour exists. */
	defaultColor?: string;
	label?: string;
	qaId?: string;
};

type ColorSwatchPickerProps = Omit<
	ComponentProps<typeof ToggleGroup>,
	"value" | "defaultValue" | "onValueChange" | "multiple" | "children"
> & {
	swatches: readonly ColorSwatch[];
	value: string | null;
	onValueChange: (value: string) => void;
	/** Adds a swatch that opens the system colour picker. */
	custom?: CustomColorOption;
};

/** Toggle value for the custom swatch before a custom colour exists. */
const UNSET_CUSTOM_VALUE = "custom:unset";

function Swatch({ color, dashed = false }: { color?: string; dashed?: boolean }) {
	return (
		<span
			aria-hidden="true"
			className={cn(
				"border-foreground/10 flex size-4 items-center justify-center rounded-full border",
				dashed && "border-muted-foreground/50 border-dashed",
			)}
			style={color ? { backgroundColor: color } : undefined}
		>
			{dashed ? <PlusIcon className="text-muted-foreground size-2.5" /> : null}
		</span>
	);
}

function SwatchTooltip({ label, children }: { label: string; children: React.ReactElement }) {
	return (
		<Tooltip>
			<TooltipTrigger render={children} />
			<TooltipContent>{label}</TooltipContent>
		</Tooltip>
	);
}

/**
 * Single-choice colour picker on stock `ToggleGroup` (the Appearance accent
 * style): one swatch per colour, optional text options, and an optional
 * custom swatch that opens the system colour picker. A pressed item can't
 * be un-pressed, so there is always a selection once one is made.
 */
function ColorSwatchPicker({
	swatches,
	value,
	onValueChange,
	custom,
	disabled,
	className,
	...props
}: ColorSwatchPickerProps) {
	const colorInputRef = useRef<HTMLInputElement>(null);
	const customValue = custom?.color ?? UNSET_CUSTOM_VALUE;
	const customLabel = custom?.label ?? "Custom color";

	const openSystemPicker = () => {
		const input = colorInputRef.current;
		if (!input) return;
		try {
			input.showPicker();
		} catch {
			// showPicker throws without user activation or inside cross-origin frames.
			input.click();
		}
	};

	return (
		<ToggleGroup
			value={value ? [value] : []}
			onValueChange={([next]) => {
				if (next && next !== UNSET_CUSTOM_VALUE) onValueChange(next);
			}}
			disabled={disabled}
			spacing={1}
			className={cn("flex-wrap", className)}
			{...props}
		>
			{swatches.map((swatch) => {
				const item = (
					<ToggleGroupItem
						key={swatch.value}
						value={swatch.value}
						aria-label={swatch.label}
						{...(swatch.qaId ? { "data-qa-id": swatch.qaId } : {})}
					>
						{swatch.color ? <Swatch color={swatch.color} /> : swatch.label}
					</ToggleGroupItem>
				);
				return swatch.color ? (
					<SwatchTooltip key={swatch.value} label={swatch.label}>
						{item}
					</SwatchTooltip>
				) : (
					item
				);
			})}
			{custom ? (
				<>
					<SwatchTooltip label={customLabel}>
						<ToggleGroupItem
							value={customValue}
							aria-label={custom.color ? `${customLabel} ${custom.color}` : customLabel}
							onClick={openSystemPicker}
							{...(custom.qaId ? { "data-qa-id": custom.qaId } : {})}
						>
							{custom.color ? <Swatch color={custom.color} /> : <Swatch dashed />}
						</ToggleGroupItem>
					</SwatchTooltip>
					<input
						ref={colorInputRef}
						type="color"
						tabIndex={-1}
						aria-hidden="true"
						className="sr-only"
						value={custom.color ?? custom.defaultColor ?? "#000000"}
						disabled={disabled}
						onChange={(event) => onValueChange(event.target.value.toUpperCase())}
					/>
				</>
			) : null}
		</ToggleGroup>
	);
}

export { ColorSwatchPicker };
export type { ColorSwatch, ColorSwatchPickerProps, CustomColorOption };
