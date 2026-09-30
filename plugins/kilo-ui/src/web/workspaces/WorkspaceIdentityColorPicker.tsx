import { useState } from "react";

import { ColorSwatchPicker } from "@kilo-desktop/ui/components/color-swatch-picker";

import {
	normalizeWorkspaceIdentityColor,
	WORKSPACE_IDENTITY_COLORS,
} from "../../contracts/workspaces/schemas.js";

type WorkspaceIdentityColorPickerProps = {
	value: string | null | undefined;
	onChange: (color: string) => void;
	disabled?: boolean;
	"aria-label"?: string;
	className?: string;
};

const PRESET_NAMES: Record<(typeof WORKSPACE_IDENTITY_COLORS)[number], string> = {
	"#5EA0F7": "Blue",
	"#34D399": "Green",
	"#F87171": "Red",
	"#A78BFA": "Purple",
	"#22D3EE": "Cyan",
	"#FBBF24": "Amber",
};

const SWATCHES = WORKSPACE_IDENTITY_COLORS.map((color) => ({
	value: color,
	label: PRESET_NAMES[color],
	color,
}));

const PRESET_SET = new Set<string>(WORKSPACE_IDENTITY_COLORS);

/** Workspace identity colour (create + edit): presets plus a custom colour. */
export function WorkspaceIdentityColorPicker({
	value,
	onChange,
	disabled = false,
	"aria-label": ariaLabel = "Identity color",
	className,
}: WorkspaceIdentityColorPickerProps) {
	const normalized = normalizeWorkspaceIdentityColor(value);
	const current = normalized !== null && !PRESET_SET.has(normalized) ? normalized : null;
	const [lastCustom, setLastCustom] = useState(current);
	if (current !== null && current !== lastCustom) setLastCustom(current);

	return (
		<ColorSwatchPicker
			aria-label={ariaLabel}
			data-qa-id="workspace-identity-color"
			swatches={SWATCHES}
			value={normalized}
			onValueChange={(next) => {
				const color = normalizeWorkspaceIdentityColor(next);
				if (color) onChange(color);
			}}
			custom={{ color: lastCustom }}
			disabled={disabled}
			{...(className ? { className } : {})}
		/>
	);
}
