import { BotIcon, FileIcon, NotebookIcon, WrenchIcon } from "lucide-react";
import type { ComponentType } from "react";

import type { PaneKind } from "@anaconda-agentic-desktop/pane-layout";

export type PaneIconOverride = {
	readonly Icon: ComponentType<{ readonly className?: string; readonly iconKey?: string }>;
	readonly iconKey?: string;
};

export const PANE_KIND_ICON: Record<PaneKind, typeof BotIcon> = {
	agent: BotIcon,
	document: FileIcon,
	notebook: NotebookIcon,
	tool: WrenchIcon,
};

export const PANE_KIND_ICON_CLASS: Record<PaneKind, string> = {
	agent: "text-primary",
	document: "text-info-foreground",
	notebook: "text-chart-4",
	tool: "text-chart-2",
};
