import { KernelCommand, type PluginSdk } from "@kilo-desktop/kernel";
import { LeftSidebar } from "@kilo-desktop/plugin-shell/contracts";

import { WorkSessions, WorkSessionsWindow } from "../../contracts";
import { sessionsNeedingAttention } from "../attention/live-activity";
import { visibleWorkSessions, workSessionSearch } from "../shared/list-state";
import { nextCandidateId } from "../shared/numbered";
import { provideWorkSessionRenderers } from "../shared/work-session-renderers";
import { handOverLegacyPins } from "./legacy-pins";
import { WORK_SESSION_RENDERERS } from "./session-renderers";
import { SessionList } from "./SessionList";

/**
 * The list area: the session list in the left sidebar, how a work session
 * looks wherever it is shown (handed to work sessions views in every window,
 * pop-outs included), and the commands that act on what the list shows.
 */
export function activateList(sdk: PluginSdk): void {
	sdk.onDispose(provideWorkSessionRenderers(WORK_SESSION_RENDERERS));
	if (sdk.context.get("kernel/secondaryWindow")) return;
	sdk.extensions.implement(LeftSidebar, "work-sessions", SessionList);
	implementListCommands(sdk);
	handOverLegacyPins(sdk);
}

function implementListCommands(sdk: PluginSdk): void {
	const window = () => sdk.domainObjects.get(WorkSessionsWindow);
	const activeWorkSessionId = () => window()?.getState().activeWorkSessionId ?? undefined;
	const command = (id: string, handler: () => void) =>
		sdk.extensions.implement(KernelCommand, id, handler);

	command("search-work-sessions", workSessionSearch.toggle);
	command("next-attention-work-session", () => {
		const order = visibleWorkSessions.get();
		const workSessionId = nextCandidateId(
			order,
			sessionsNeedingAttention(sdk, order),
			activeWorkSessionId(),
		);
		if (workSessionId) void window()?.methods.openWorkSession({ workSessionId });
	});
	command("toggle-pin-work-session", () => {
		const workSessions = sdk.domainObjects.get(WorkSessions);
		const workSession = workSessions
			?.getState()
			.workSessions.find(({ id }) => id === activeWorkSessionId());
		if (!workSessions || !workSession || workSession.archived) return;
		void workSessions.methods
			.setPinned({ id: workSession.id, pinned: !workSession.pinned })
			.catch(() => undefined);
	});
}
