import { BlocksIcon, SparklesIcon, TerminalIcon, ZapIcon, type LucideIcon } from "lucide-react";

import type { SlashCategory } from "./kilo-slash-command";

export const SLASH_CATEGORY_ICONS: Record<SlashCategory, LucideIcon> = {
	action: ZapIcon,
	command: TerminalIcon,
	skill: SparklesIcon,
	mcp: BlocksIcon,
};

export function slashCategoryIcon(category: string): LucideIcon {
	return Object.hasOwn(SLASH_CATEGORY_ICONS, category)
		? SLASH_CATEGORY_ICONS[category as SlashCategory]
		: TerminalIcon;
}
