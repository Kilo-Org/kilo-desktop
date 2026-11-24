import { KernelError, type PluginSdk } from "@kilo-desktop/kernel";
import { WorkSessions } from "@kilo-desktop/plugin-work-sessions/contracts";

import { CHAT_PLUGIN_ID, Drafts, type WorkSessionDrafts } from "../../contracts";

/**
 * The `drafts` domain object: unsent composer text by work session and agent
 * pane, in main so the pane starts from it in any window. In memory only, as
 * before. A removed work session takes its drafts with it.
 */
export function activateDrafts(sdk: PluginSdk): void {
	const provider = sdk.domainObjects.provide(Drafts, {
		initialState: { drafts: {} },
		methods: {
			setText: ({ workSessionId, paneId, text }, caller) => {
				if (caller.pluginId !== CHAT_PLUGIN_ID) {
					throw new KernelError("PERMISSION_DENIED", "Only kilo.chat keeps composer drafts.");
				}
				const { [workSessionId]: previous, ...others } = provider.state.drafts;
				const next = withDraft(previous, paneId, text);
				if (sameDrafts(previous, next)) return;
				provider.setState({ drafts: next ? { ...others, [workSessionId]: next } : others });
			},
		},
	});

	let stop = () => {};
	sdk.domainObjects.track(WorkSessions, {
		added: (workSessions) => {
			const prune = () => {
				const live = new Set(
					workSessions.getState().workSessions.map((workSession) => workSession.id),
				);
				const drafts = provider.state.drafts;
				if (Object.keys(drafts).every((id) => live.has(id))) return;
				provider.setState({
					drafts: Object.fromEntries(Object.entries(drafts).filter(([id]) => live.has(id))),
				});
			};
			stop = workSessions.subscribe(prune);
		},
		removed: () => stop(),
	});
}

/** A work session's drafts with the pane's (or the work session's own) text set; undefined once all are empty. */
function withDraft(
	current: WorkSessionDrafts | undefined,
	paneId: string | undefined,
	text: string,
): WorkSessionDrafts | undefined {
	const ownText = paneId ? (current?.text ?? "") : text;
	const panes = { ...current?.panes };
	if (paneId && text) panes[paneId] = text;
	else if (paneId) delete panes[paneId];
	const hasPanes = Object.keys(panes).length > 0;
	if (!ownText && !hasPanes) return undefined;
	return hasPanes ? { text: ownText, panes } : { text: ownText };
}

function sameDrafts(a: WorkSessionDrafts | undefined, b: WorkSessionDrafts | undefined): boolean {
	return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}
