import type { DomainObjectHandle, PluginSdk } from "@kilo-desktop/kernel";

import { Panes, WorkSessions, type WorkSession, type WorkSessionPanes } from "../../contracts";
import { originPaneSessionIds, readOriginPanes } from "./origin-panes-model";

/** Where origin kept each session's panes and layout, in the main window's localStorage. */
export const ORIGIN_PANES_STORAGE_KEY = "kilo-ui:right-panel-state:v3";
/** Set once origin's panes were handed over, so later changes stick. */
export const ORIGIN_PANES_HANDED_OVER_KEY = "kilo.work-sessions.origin-panes-handed-over";

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

function readOriginState(): unknown {
	try {
		const raw = localStorage.getItem(ORIGIN_PANES_STORAGE_KEY);
		return raw === null ? undefined : (JSON.parse(raw) as unknown);
	} catch {
		return undefined;
	}
}

/**
 * Main can't read the renderer's localStorage, so the main window reopens
 * origin's saved panes, once. It waits for the work sessions they name:
 * origin's are imported in the background, all at once. A work session whose
 * panes the person changed keeps them; kilo.chat's untouched agent pane is
 * reused, or closed where origin had closed the chat. Origin's key is left
 * alone so a downgrade still finds it.
 */
export function handOverOriginPanes(sdk: PluginSdk): void {
	if (localStorage.getItem(ORIGIN_PANES_HANDED_OVER_KEY)) return;
	const state = readOriginState();
	const named = new Set(originPaneSessionIds(state));
	if (named.size === 0) return;
	let stop: (() => void) | undefined;
	sdk.domainObjects.track(WorkSessions, {
		added: (workSessions) => {
			const tryHandOver = ({ workSessions: list }: { workSessions: readonly WorkSession[] }) => {
				const known = list.filter((workSession) => named.has(workSession.id));
				const panes = sdk.domainObjects.get(Panes);
				if (known.length === 0 || !panes) return;
				localStorage.setItem(ORIGIN_PANES_HANDED_OVER_KEY, "1");
				stop?.();
				stop = undefined;
				const records = readOriginPanes(state, known, panes.getState().byWorkSession);
				for (const [workSessionId, record] of Object.entries(records)) {
					reopen(panes, workSessionId, record).catch((error: unknown) =>
						sdk.logger.warn(
							`Could not reopen origin's panes of work session ${workSessionId}: ${errorText(error)}`,
						),
					);
				}
			};
			stop = workSessions.subscribe(tryHandOver);
			tryHandOver(workSessions.getState());
		},
		removed: () => {
			stop?.();
			stop = undefined;
		},
	});
	sdk.onDispose(() => stop?.());
}

async function reopen(
	panes: DomainObjectHandle<typeof Panes>,
	workSessionId: string,
	record: WorkSessionPanes,
): Promise<void> {
	for (const pane of record.panes) {
		// Panes open in their saved order, which is the order their tabs take.
		// react-doctor-disable-next-line react-doctor/async-await-in-loop
		await panes.methods.open({
			workSessionId,
			paneId: pane.id,
			kind: pane.kind,
			title: pane.title,
			...(pane.iconKey ? { iconKey: pane.iconKey } : {}),
			metadata: pane.metadata,
			activate: false,
		});
	}
	const agentPaneId = `agent:${workSessionId}`;
	if (!record.panes.some((pane) => pane.id === agentPaneId)) {
		// kilo.chat may have opened it already; this window's state can lag behind main's.
		await panes.methods.close({ workSessionId, paneId: agentPaneId });
	}
	if (record.layout !== null) {
		await panes.methods.setLayout({
			workSessionId,
			layout: record.layout,
			activePaneId: record.activePaneId,
		});
	} else if (record.activePaneId) {
		await panes.methods.activate({ workSessionId, paneId: record.activePaneId });
	}
	if (record.arrangement !== "tiles") {
		await panes.methods.setArrangement({ workSessionId, arrangement: record.arrangement });
	}
}
