import { PlusIcon } from "lucide-react";
import { useId } from "react";

import { cn } from "@anaconda-agentic-desktop/ui/lib/utils";

import {
	normalizeWorkspaceIdentityColor,
	WORKSPACE_IDENTITY_COLORS,
} from "../../contracts/workspaces/schemas.js";

type WorkspaceIdentityColorPickerProps = {
	value: string | null | undefined;
	onChange: (color: string) => void;
	disabled?: boolean;
	"aria-label"?: string;
};

const PRESET_SET = new Set<string>(WORKSPACE_IDENTITY_COLORS.map((swatch) => swatch.toUpperCase()));
const DEFAULT_CUSTOM_COLOR = "#000000";

const swatchClassName = (selected: boolean) =>
	cn(
		"block size-[22px] shrink-0 cursor-pointer rounded-full outline-none transition-[box-shadow,transform] peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
		selected
			? "scale-105 shadow-[0_0_0_2px_var(--background),0_0_0_4px_color-mix(in_srgb,var(--foreground)_55%,transparent)]"
			: "shadow-[0_0_0_2px_var(--background)] hover:scale-105",
	);

/**
 * Swatch radiogroup for workspace identity colors (create + edit),
 * plus a custom color control that opens the system color picker.
 */
export function WorkspaceIdentityColorPicker({
	value,
	onChange,
	disabled = false,
	"aria-label": ariaLabel = "Identity color",
}: WorkspaceIdentityColorPickerProps) {
	const name = useId();
	const normalized = normalizeWorkspaceIdentityColor(value);
	const isPreset = normalized !== null && PRESET_SET.has(normalized);
	const isCustom = normalized !== null && !isPreset;
	const customColor = isCustom ? normalized : DEFAULT_CUSTOM_COLOR;

	return (
		<div
			className="flex items-center gap-2.5"
			role="radiogroup"
			aria-label={ariaLabel}
			data-qa-id="workspace-identity-color"
		>
			{WORKSPACE_IDENTITY_COLORS.map((swatch) => {
				const isSelected = isPreset && normalized === swatch.toUpperCase();
				return (
					<label key={swatch}>
						<input
							type="radio"
							name={name}
							value={swatch}
							checked={isSelected}
							aria-label={`Color ${swatch}`}
							disabled={disabled}
							onChange={() => onChange(swatch)}
							className="peer sr-only"
						/>
						<span
							aria-hidden
							className={swatchClassName(isSelected)}
							style={{ backgroundColor: swatch }}
						/>
					</label>
				);
			})}
			<span
				className={cn(
					"relative flex size-[22px] shrink-0 items-center justify-center rounded-full has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background",
					isCustom
						? "scale-105 shadow-[0_0_0_2px_var(--background),0_0_0_4px_color-mix(in_srgb,var(--foreground)_55%,transparent)]"
						: "border-muted-foreground/45 hover:border-muted-foreground/70 border border-dashed bg-transparent hover:scale-105",
					disabled && "opacity-50",
				)}
				style={isCustom ? { backgroundColor: normalized } : undefined}
			>
				<input
					type="radio"
					name={name}
					value={customColor}
					checked={isCustom}
					aria-label={isCustom ? `Custom color ${normalized}` : "Custom color"}
					disabled={disabled}
					onChange={() => onChange(customColor)}
					className="sr-only"
				/>
				{!isCustom ? (
					<PlusIcon className="text-muted-foreground pointer-events-none size-3" aria-hidden />
				) : null}
				<input
					type="color"
					aria-label="Choose custom color"
					value={customColor}
					disabled={disabled}
					className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
					onChange={(event) => {
						const next = normalizeWorkspaceIdentityColor(event.target.value);
						if (next) onChange(next);
					}}
				/>
			</span>
		</div>
	);
}
