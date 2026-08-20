import { PlusIcon } from "lucide-react";

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

const swatchClassName = (selected: boolean) =>
	cn(
		"size-[22px] shrink-0 rounded-full outline-none transition-[box-shadow,transform] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50",
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
	const normalized = normalizeWorkspaceIdentityColor(value);
	const isPreset = normalized !== null && PRESET_SET.has(normalized);
	const isCustom = normalized !== null && !isPreset;
	const colorInputValue = normalized ?? WORKSPACE_IDENTITY_COLORS[0];

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
					<button
						key={swatch}
						type="button"
						role="radio"
						aria-checked={isSelected}
						aria-label={`Color ${swatch}`}
						disabled={disabled}
						onClick={() => onChange(swatch)}
						className={swatchClassName(isSelected)}
						style={{ backgroundColor: swatch }}
					/>
				);
			})}

			<span
				className={cn(
					"relative flex size-[22px] shrink-0 items-center justify-center rounded-full",
					isCustom
						? "scale-105 shadow-[0_0_0_2px_var(--background),0_0_0_4px_color-mix(in_srgb,var(--foreground)_55%,transparent)]"
						: "border-muted-foreground/45 hover:border-muted-foreground/70 border border-dashed bg-transparent hover:scale-105",
					disabled && "opacity-50",
				)}
				style={isCustom ? { backgroundColor: normalized } : undefined}
			>
				{!isCustom ? (
					<PlusIcon className="text-muted-foreground pointer-events-none size-3" aria-hidden />
				) : null}
				<input
					type="color"
					role="radio"
					aria-checked={isCustom}
					aria-label={isCustom ? `Custom color ${normalized}` : "Choose custom color"}
					value={colorInputValue}
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
