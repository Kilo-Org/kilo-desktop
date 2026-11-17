import { KernelError, mainHost, type PluginSdk } from "@kilo-desktop/kernel";
import { WorkSessions } from "@kilo-desktop/plugin-work-sessions/contracts";

import { SessionWorkbooks, Workbooks } from "../contracts";

interface SavedSessions extends Record<string, unknown> {
	bySession: Record<string, string>;
}

export interface SessionWorkbooksDeps {
	/** Records a workbook's use in a workspace, or (null) none. */
	readonly recordUse: (workbookId: string, workspaceId: string | null) => void;
}

/**
 * Provides `kilo.workbooks/session-workbooks`: each work session's active
 * workbook, saved in kv. Entries go when their session is deleted or their
 * workbook is forgotten, so a lookup never points at something gone. Setting
 * a session's workbook records the use, in the session's workspace.
 */
export function provideSessionWorkbooks(sdk: PluginSdk, deps: SessionWorkbooksDeps): void {
	const store = mainHost(sdk).storage.kv<SavedSessions>({
		namespace: "session-workbooks",
		defaults: { bySession: {} },
	});
	const sessions = sdk.domainObjects.provide(SessionWorkbooks, {
		initialState: { bySession: { ...store.get("bySession") } },
		methods: {
			setActive: ({ workSessionId, workbookId }) => {
				if (workbookId && !sdk.domainObjects.get(Workbooks)?.lookup(workbookId)) {
					throw new KernelError("NOT_FOUND", `No workbook "${workbookId}".`);
				}
				const next = { ...sessions.state.bySession };
				if (workbookId) next[workSessionId] = workbookId;
				else delete next[workSessionId];
				save(next);
				if (workbookId) deps.recordUse(workbookId, workspaceOfSession(workSessionId));
			},
		},
	});

	function save(next: Record<string, string>) {
		store.set({ bySession: next });
		sessions.setState({ bySession: next });
	}

	function keep(predicate: (workSessionId: string, workbookId: string) => boolean) {
		const current = sessions.state.bySession;
		const next = Object.fromEntries(
			Object.entries(current).filter(([session, workbook]) => predicate(session, workbook)),
		);
		if (Object.keys(next).length !== Object.keys(current).length) save(next);
	}

	function workspaceOfSession(workSessionId: string): string | null {
		return (
			sdk.domainObjects
				.get(WorkSessions)
				?.getState()
				.workSessions.find((session) => session.id === workSessionId)?.workspaceId ?? null
		);
	}

	const workSessions = sdk.domainObjects.get(WorkSessions);
	workSessions?.on("deleted", ({ workSession }) => keep((session) => session !== workSession.id));
	const workbooks = sdk.domainObjects.get(Workbooks);
	workbooks?.subscribe((state) => {
		const ids = new Set(state.workbooks.map((workbook) => workbook.id));
		keep((_, workbook) => ids.has(workbook));
	});
}
