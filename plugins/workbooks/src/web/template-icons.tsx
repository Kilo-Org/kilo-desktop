import { CodeIcon, NotebookIcon, NotebookTabsIcon, type LucideIcon } from "lucide-react";

const TEMPLATE_ICONS: Readonly<Record<string, LucideIcon>> = {
	code: CodeIcon,
	notebook: NotebookIcon,
};

/** The icon a template names (`icon` in workbook.json), or a notebook when it names none we know. */
export function TemplateIcon({
	icon,
	className,
}: {
	icon: string | undefined;
	className?: string;
}) {
	const Icon: LucideIcon = TEMPLATE_ICONS[icon ?? ""] ?? NotebookTabsIcon;
	return <Icon className={className} />;
}
