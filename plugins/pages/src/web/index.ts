import { FileTextIcon } from "lucide-react";

import { definePlugin, KernelCommand } from "@kilo-desktop/kernel";
import { PaneKind, WorkSessionsWindow } from "@kilo-desktop/plugin-work-sessions/contracts";

import { PAGES_PANE_KIND } from "../contracts/index.js";
import { PagesPane } from "./PagesPane.js";

export { PagesPane } from "./PagesPane.js";

/** kilo.pages' renderer entry: the Pages pane kind and Open Pages. */
export const pagesWebEntry = definePlugin({
	activate(sdk) {
		sdk.extensions.implement(PaneKind, "pages", { component: PagesPane, icon: FileTextIcon });
		sdk.extensions.implement(KernelCommand, "open", async () => {
			await sdk.domainObjects.get(WorkSessionsWindow)?.methods.openPane({ kind: PAGES_PANE_KIND });
		});
	},
});
