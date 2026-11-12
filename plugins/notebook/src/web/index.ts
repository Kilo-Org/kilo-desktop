import { createElement, type ComponentType } from "react";

import { definePlugin, KernelCommand } from "@kilo-desktop/kernel";
import { PermissionRenderer } from "@kilo-desktop/plugin-chat/contracts";
import { SettingsSection } from "@kilo-desktop/plugin-shell/contracts";
import {
	PaneKind,
	WorkSessionsWindow,
	type PaneProps,
} from "@kilo-desktop/plugin-work-sessions/contracts";
import { NotebookIcon } from "lucide-react";

import { NOTEBOOK_PANE_KIND } from "../contracts/index.js";
import { CloseGuards, CloseGuardsContext } from "./close-guards.js";
import { notebookExecuteInteractions } from "./notebook-interactions.js";
import { NotebookPane } from "./NotebookPane.js";
import { NotebookSettings } from "./NotebookSettings.js";

export { NotebookPane } from "./NotebookPane.js";
export { NotebookSettings } from "./NotebookSettings.js";

function withCloseGuards(guards: CloseGuards, Pane: ComponentType<PaneProps>) {
	return function GuardedNotebookPane(props: PaneProps) {
		return createElement(
			CloseGuardsContext.Provider,
			{ value: guards },
			createElement(Pane, props),
		);
	};
}

/**
 * kilo.notebook's renderer entry: the Notebook pane kind (kept alive, with a
 * close guard for unsaved notebooks), the Notebooks settings section, and the
 * code shown on the agent's notebook code permission card.
 */
export const notebookWebEntry = definePlugin({
	activate(sdk) {
		const guards = new CloseGuards();
		sdk.extensions.implement(PaneKind, "notebook", {
			component: withCloseGuards(guards, NotebookPane),
			icon: NotebookIcon,
			canClose: guards.canClose,
		});
		sdk.extensions.implement(KernelCommand, "open", () =>
			sdk.domainObjects.get(WorkSessionsWindow)?.methods.openPane({ kind: NOTEBOOK_PANE_KIND }),
		);
		sdk.extensions.implement(SettingsSection, "notebooks", {
			component: NotebookSettings,
			icon: NotebookIcon,
		});
		sdk.extensions.implement(PermissionRenderer, "execute", notebookExecuteInteractions);
	},
});
