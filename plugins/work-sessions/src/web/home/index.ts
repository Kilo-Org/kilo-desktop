import { KernelCommand, type PluginSdk } from "@kilo-desktop/kernel";

import { WorkSessions, WorkSessionsWindow, Workspaces } from "../../contracts";
import { startFromNewWorkSessionPage } from "../shared/new-work-session-start";
import { startNewWorkSession } from "./new-session";

/**
 * The New Session page's commands; the page itself (`NewWorkSessionPage`) is
 * drawn by the window's main view while no work session is open.
 */
export function activateHome(sdk: PluginSdk): void {
	if (sdk.context.get("kernel/secondaryWindow")) return;
	sdk.extensions.implement(KernelCommand, "new-work-session", () =>
		startNewWorkSession({
			workSessions: sdk.domainObjects.get(WorkSessions),
			window: sdk.domainObjects.get(WorkSessionsWindow),
			workspaces: sdk.domainObjects.get(Workspaces),
		}),
	);
	sdk.extensions.implement(KernelCommand, "new-empty-work-session", () => {
		startFromNewWorkSessionPage();
	});
}
