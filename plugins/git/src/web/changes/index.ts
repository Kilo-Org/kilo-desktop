import { KernelCommand, type PluginSdk } from "@kilo-desktop/kernel";
import { PaneKind, WorkSessionsWindow } from "@kilo-desktop/plugin-work-sessions/contracts";

import { CHANGES_PANE_KIND } from "../../contracts";
import type { GitWindow } from "../shared/git-window";
import { withRepositoryQueries } from "../shared/repository-queries";
import { ChangesIcon, ChangesPane } from "./ChangesPane";

/** Shows the Changes pane of the work session this window has open. */
async function openChanges(sdk: PluginSdk): Promise<void> {
	await sdk.domainObjects.get(WorkSessionsWindow)?.methods.openPane({ kind: CHANGES_PANE_KIND });
}

/** The Changes pane kind and Open Changes. */
export function activateChanges(sdk: PluginSdk, { queries }: GitWindow): void {
	sdk.extensions.implement(PaneKind, "changes", {
		component: withRepositoryQueries(queries, ChangesPane),
		icon: ChangesIcon,
	});
	sdk.extensions.implement(KernelCommand, "open-changes", () => openChanges(sdk));
}
