import type { Pane, PaneArrangement, SessionPanes } from "../contracts";

/**
 * Origin's right-panel tab definitions → the pane kinds of the plugins that
 * take them over. Panes of kinds whose plugin isn't installed yet stay listed
 * and render as unavailable until it is.
 */
export const LEGACY_PANE_KINDS: Readonly<Record<string, string>> = {
	"browser.browser": "kilo.browser/browser",
	"files.files": "kilo.files/files",
	"git.changes": "kilo.git/changes",
	"notebook.notebook": "kilo.notebook/notebook",
	"terminal.terminal": "kilo.terminal/terminal",
	"kilo-ui.plan": "kilo.chat/plan",
	"kilo-ui.subagent": "kilo.chat/subagent",
};

/** Origin's chat pane, one per session, kept under this id in its layout. */
export const LEGACY_AGENT_KIND = "kilo.chat/agent";
const agentPaneId = (sessionId: string) => `agent:${sessionId}`;

type Record_ = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is Record_ =>
	typeof value === "object" && value !== null && !Array.isArray(value);

function readMetadata(value: unknown): Record<string, string> {
	if (!isRecord(value)) return {};
	return Object.fromEntries(
		Object.entries(value).filter(
			(entry): entry is [string, string] => typeof entry[1] === "string",
		),
	);
}

/** Origin kept the plan tab's revision on the session, not the tab; the plan pane keeps it in metadata. */
function planAnchors(entry: Record_): Record<string, string> {
	const anchors: Record<string, string> = {};
	if (typeof entry.planAnchorCallId === "string" && entry.planAnchorCallId) {
		anchors.planAnchorCallId = entry.planAnchorCallId;
	}
	if (
		typeof entry.planNewestAnchorCallIdAtOpen === "string" &&
		entry.planNewestAnchorCallIdAtOpen
	) {
		anchors.planNewestAnchorCallIdAtOpen = entry.planNewestAnchorCallIdAtOpen;
	}
	return anchors;
}

function readTab(value: unknown, entry: Record_): Pane | null {
	if (!isRecord(value)) return null;
	const { instanceId, definitionId, title, iconKey, ordinal, metadata } = value;
	if (typeof instanceId !== "string" || typeof definitionId !== "string") return null;
	const kind = LEGACY_PANE_KINDS[definitionId];
	if (!kind) return null;
	return {
		id: instanceId,
		kind,
		title: typeof title === "string" && title ? title : "Pane",
		...(typeof iconKey === "string" ? { iconKey } : {}),
		metadata:
			definitionId === "kilo-ui.plan"
				? { ...readMetadata(metadata), ...planAnchors(entry) }
				: readMetadata(metadata),
		ordinal: typeof ordinal === "number" && ordinal >= 1 ? Math.floor(ordinal) : 1,
	};
}

/**
 * Reads origin's `kilo-ui:right-panel-state:v3` (zustand persist) into panes
 * per session. Sessions it names but this app doesn't know are skipped. The
 * chat pane becomes an agent pane unless origin had it closed.
 */
export function readLegacyPanes(
	state: unknown,
	sessionTitles: ReadonlyMap<string, string>,
): Record<string, SessionPanes> {
	const bySessionId =
		isRecord(state) && isRecord(state.state) ? state.state.bySessionId : undefined;
	if (!isRecord(bySessionId)) return {};
	const result: Record<string, SessionPanes> = {};
	for (const [sessionId, entry] of Object.entries(bySessionId)) {
		const title = sessionTitles.get(sessionId);
		if (title === undefined || !isRecord(entry)) continue;
		const tabs = Array.isArray(entry.tabs)
			? entry.tabs.map((tab) => readTab(tab, entry)).filter((t) => t !== null)
			: [];
		const agent: Pane[] =
			entry.chatPaneOpen === false
				? []
				: [
						{
							id: agentPaneId(sessionId),
							kind: LEGACY_AGENT_KIND,
							title,
							metadata: {},
							ordinal: 1,
						},
					];
		const panes = [...agent, ...tabs];
		if (panes.length === 0) continue;
		const arrangement: PaneArrangement = entry.arrangement === "carousel" ? "carousel" : "tiles";
		const active = typeof entry.activeTabId === "string" ? entry.activeTabId : null;
		result[sessionId] = {
			panes,
			activePaneId: panes.some((pane) => pane.id === active) ? active : (panes[0]?.id ?? null),
			layout: typeof entry.layoutJson === "string" ? entry.layoutJson : null,
			arrangement,
		};
	}
	return result;
}
