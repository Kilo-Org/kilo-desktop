import { BlocksIcon, SparklesIcon, TerminalIcon, type LucideIcon } from "lucide-react";

import type { SlashSourceCategory } from "./kilo-slash-command.js";

export const SLASH_CATEGORY_ICONS: Record<SlashSourceCategory, LucideIcon> = {
	command: TerminalIcon,
	skill: SparklesIcon,
	mcp: BlocksIcon,
};

export function slashCategoryIcon(category: string): LucideIcon {
	if (category === "skill" || category === "mcp" || category === "command") {
		return SLASH_CATEGORY_ICONS[category];
	}
	return TerminalIcon;
}
