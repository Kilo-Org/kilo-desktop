import type { Pane, PaneArrangement, WorkSession, WorkSessionPanes } from "../../contracts/model";

/*
 * Origin's saved panes: its main window's localStorage key
 * `kilo-ui:right-panel-state:v3`, a zustand persist value
 * `{ state: { bySessionId } }`. Each session's entry lists its extra tabs, the
 * active tab, the canvas layout (`@kilo-desktop/pane-layout` JSON, read as is)
 * and the arrangement; origin showed the session's chat without saving it,
 * in the layout as `agent:<sessionId>`.
 */

/** Origin's tab definitions → the pane kinds that took them over. */
const ORIGIN_PANE_KINDS: Readonly<Record<string, string>> = {
	"browser.browser": "kilo.browser/browser",
	"files.files": "kilo.files/files",
	"git.changes": "kilo.git/changes",
	"notebook.notebook": "kilo.notebook/notebook",
	"terminal.terminal": "kilo.terminal/terminal",
	"kilo-ui.plan": "kilo.chat/plan",
	"kilo-ui.subagent": "kilo.chat/subagent",
};

/** kilo.chat's agent pane kind (kilo.chat depends on this plugin, so it is named here). */
const AGENT_PANE_KIND = "kilo.chat/agent";

/** Must match the id in origin's saved layouts and the one kilo.chat opens. */
const agentPaneId = (workSessionId: string) => `agent:${workSessionId}`;

type UnknownRecord = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is UnknownRecord =>
	typeof value === "object" && value !== null && !Array.isArray(value);

function stringMetadata(value: unknown): Record<string, string> {
	if (!isRecord(value)) return {};
	return Object.fromEntries(
		Object.entries(value).filter(
			(entry): entry is [string, string] => typeof entry[1] === "string",
		),
	);
}

/** Origin kept the plan tab's revision on the session's entry; the plan pane keeps it in metadata. */
function planAnchors(entry: UnknownRecord): Record<string, string> {
	const anchors: Record<string, string> = {};
	for (const key of ["planAnchorCallId", "planNewestAnchorCallIdAtOpen"]) {
		const value = entry[key];
		if (typeof value === "string" && value) anchors[key] = value;
	}
	return anchors;
}

function readTab(value: unknown, entry: UnknownRecord): Pane | null {
	if (!isRecord(value)) return null;
	const { instanceId, definitionId, title, iconKey, ordinal, metadata } = value;
	if (typeof instanceId !== "string" || typeof definitionId !== "string") return null;
	const kind = ORIGIN_PANE_KINDS[definitionId];
	if (!kind) return null;
	return {
		id: instanceId,
		kind,
		title: typeof title === "string" && title ? title : "Pane",
		...(typeof iconKey === "string" ? { iconKey } : {}),
		metadata:
			definitionId === "kilo-ui.plan"
				? { ...stringMetadata(metadata), ...planAnchors(entry) }
				: stringMetadata(metadata),
		ordinal: typeof ordinal === "number" && ordinal >= 1 ? Math.floor(ordinal) : 1,
	};
}

function readEntry(entry: UnknownRecord, workSession: WorkSession): WorkSessionPanes | null {
	const tabs = Array.isArray(entry.tabs)
		? entry.tabs.flatMap((tab) => readTab(tab, entry) ?? [])
		: [];
	const agent: Pane[] =
		entry.chatPaneOpen === false
			? []
			: [
					{
						id: agentPaneId(workSession.id),
						kind: AGENT_PANE_KIND,
						title: workSession.title,
						metadata: {},
						ordinal: 1,
					},
				];
	const panes = [...agent, ...tabs];
	if (panes.length === 0) return null;
	const active = typeof entry.activeTabId === "string" ? entry.activeTabId : null;
	const arrangement: PaneArrangement = entry.arrangement === "carousel" ? "carousel" : "tiles";
	return {
		panes,
		activePaneId: panes.some((pane) => pane.id === active) ? active : panes[0]!.id,
		layout: typeof entry.layoutJson === "string" ? entry.layoutJson : null,
		arrangement,
	};
}

/** kilo.chat's agent pane for a work session made from chats, not changed since. */
function isUntouchedDefault(workSessionId: string, record: WorkSessionPanes): boolean {
	const [only] = record.panes;
	return (
		record.panes.length === 1 &&
		only!.id === agentPaneId(workSessionId) &&
		only!.kind === AGENT_PANE_KIND &&
		record.layout === null
	);
}

function entriesOf(state: unknown): UnknownRecord | null {
	const bySessionId = isRecord(state) && isRecord(state.state) ? state.state.bySessionId : null;
	return isRecord(bySessionId) ? bySessionId : null;
}

export function originPaneSessionIds(state: unknown): string[] {
	return Object.keys(entriesOf(state) ?? {});
}

/**
 * What is saved here wins, except kilo.chat's untouched default pane. Tabs of
 * kinds no plugin took over are dropped.
 */
export function readOriginPanes(
	state: unknown,
	workSessions: readonly WorkSession[],
	saved: Readonly<Record<string, WorkSessionPanes>>,
): Record<string, WorkSessionPanes> {
	const bySessionId = entriesOf(state);
	if (!bySessionId) return {};
	const imported: Record<string, WorkSessionPanes> = {};
	for (const workSession of workSessions) {
		const entry = bySessionId[workSession.id];
		if (!isRecord(entry)) continue;
		const current = saved[workSession.id];
		if (current && !isUntouchedDefault(workSession.id, current)) continue;
		const record = readEntry(entry, workSession);
		if (record) imported[workSession.id] = record;
	}
	return imported;
}
