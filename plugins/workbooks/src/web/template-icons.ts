import { CodeIcon, NotebookIcon, NotebookTabsIcon, type LucideIcon } from "lucide-react";

const TEMPLATE_ICONS: Readonly<Record<string, LucideIcon>> = {
	code: CodeIcon,
	notebook: NotebookIcon,
};

/** The icon a template names (`icon` in workbook.json), or a notebook when it names none we know. */
export function templateIcon(icon: string | undefined): LucideIcon {
	return TEMPLATE_ICONS[icon ?? ""] ?? NotebookTabsIcon;
}
