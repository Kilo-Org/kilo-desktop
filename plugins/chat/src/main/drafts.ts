import { KernelError, type PluginSdk } from "@kilo-desktop/kernel";
import { WorkSessions } from "@kilo-desktop/plugin-sessions/contracts";

import { CHAT_PLUGIN_ID, ComposerDrafts, type SessionDrafts } from "../contracts";

/**
 * The `drafts` domain object: unsent composer text by Work Session and agent
 * pane, in main so the pane starts from it in any window. A removed session
 * takes its drafts with it.
 */
export function provideDrafts(sdk: PluginSdk): void {
	const provider = sdk.domains.provide(ComposerDrafts, {
		initialState: { drafts: {} },
		methods: {
			set: ({ sessionId, paneId, text }, caller) => {
				if (caller.pluginId !== CHAT_PLUGIN_ID) {
					throw new KernelError("PERMISSION_DENIED", "Only kilo.chat keeps composer drafts.");
				}
				const { [sessionId]: previous, ...others } = provider.state.drafts;
				const next = withDraft(previous, paneId, text);
				if (sameDrafts(previous, next)) return;
				provider.setState({ drafts: next ? { ...others, [sessionId]: next } : others });
			},
		},
	});

	let stop = () => {};
	sdk.domains.track(WorkSessions, {
		added: (sessions) => {
			const prune = () => {
				const live = new Set(sessions.getState().sessions.map((session) => session.id));
				const drafts = provider.state.drafts;
				if (Object.keys(drafts).every((id) => live.has(id))) return;
				provider.setState({
					drafts: Object.fromEntries(Object.entries(drafts).filter(([id]) => live.has(id))),
				});
			};
			stop = sessions.subscribe(prune);
		},
		removed: () => stop(),
	});
}

/** A session's drafts with the pane's (or the session's own) text set; undefined once all are empty. */
function withDraft(
	current: SessionDrafts | undefined,
	paneId: string | undefined,
	text: string,
): SessionDrafts | undefined {
	const sessionText = paneId ? (current?.text ?? "") : text;
	const panes = { ...current?.panes };
	if (paneId && text) panes[paneId] = text;
	else if (paneId) delete panes[paneId];
	const hasPanes = Object.keys(panes).length > 0;
	if (!sessionText && !hasPanes) return undefined;
	return hasPanes ? { text: sessionText, panes } : { text: sessionText };
}

function sameDrafts(a: SessionDrafts | undefined, b: SessionDrafts | undefined): boolean {
	return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}
