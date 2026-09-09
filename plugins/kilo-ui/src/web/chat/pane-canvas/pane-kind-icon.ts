import { BotIcon, FileIcon, NotebookIcon, WrenchIcon } from "lucide-react";

import type { PaneKind } from "@anaconda-agentic-desktop/pane-layout";

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
