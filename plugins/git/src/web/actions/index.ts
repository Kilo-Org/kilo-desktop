import { KernelCommand, type PluginSdk } from "@kilo-desktop/kernel";
import { WorkSessionAction } from "@kilo-desktop/plugin-work-sessions/contracts";
import { toast } from "@kilo-desktop/ui/components/sonner";

import type { GitWindow } from "../shared/git-window";
import { withRepositoryQueries } from "../shared/repository-queries";
import { ActionProgress, ActionRequests, type RequestedAction } from "./action-progress";
import { createGitSessionActions } from "./GitActionsControl";

/** Hands a command to the open work session's repository control. */
function requestAction(requests: ActionRequests, action: RequestedAction): void {
	if (requests.request(action)) return;
	toast.error("No repository actions here", {
		description: "Open a session in a git repository first.",
	});
}

/** The open work session's commit / push / pull request control and its commands. */
export function activateActions(sdk: PluginSdk, { queries }: GitWindow): void {
	const requests = new ActionRequests();
	sdk.extensions.implement(
		WorkSessionAction,
		"repository-actions",
		withRepositoryQueries(
			queries,
			createGitSessionActions({ progress: new ActionProgress(), requests }),
		),
	);
	sdk.extensions.implement(KernelCommand, "commit", () => requestAction(requests, "commit"));
	sdk.extensions.implement(KernelCommand, "push", () => requestAction(requests, "push"));
	sdk.extensions.implement(KernelCommand, "create-pull-request", () =>
		requestAction(requests, "create-pr"),
	);
}
