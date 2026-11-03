import { createElement, type ComponentType } from "react";

import { definePlugin } from "@kilo-desktop/kernel";
import { PaneKind, type PaneProps } from "@kilo-desktop/plugin-sessions/contracts";
import { SettingsSection } from "@kilo-desktop/plugin-shell/contracts";
import { NotebookIcon } from "lucide-react";

import { CloseGuards, CloseGuardsContext } from "./close-guards.js";
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
 * close guard for unsaved notebooks) and the Notebooks settings section.
 */
export const notebookWebEntry = definePlugin({
	activate(sdk) {
		const guards = new CloseGuards();
		sdk.extensions.implement(PaneKind, "notebook", {
			component: withCloseGuards(guards, NotebookPane),
			icon: NotebookIcon,
			canClose: guards.canClose,
		});
		sdk.extensions.implement(SettingsSection, "notebooks", {
			component: NotebookSettings,
			icon: NotebookIcon,
		});
	},
});
