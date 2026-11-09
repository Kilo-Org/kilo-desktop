import { KernelError, type PluginSdk } from "@kilo-desktop/kernel";
import { WorkSessions } from "@kilo-desktop/plugin-sessions/contracts";

import { CHAT_PLUGIN_ID, ComposerDrafts } from "../contracts";

/**
 * The `drafts` domain object: unsent composer text by Work Session, in main
 * so every window's composer for a session starts from it. A removed session
 * takes its draft with it.
 */
export function provideDrafts(sdk: PluginSdk): void {
	const provider = sdk.domains.provide(ComposerDrafts, {
		initialState: { drafts: {} },
		methods: {
			set: ({ sessionId, text }, caller) => {
				if (caller.pluginId !== CHAT_PLUGIN_ID) {
					throw new KernelError("PERMISSION_DENIED", "Only kilo.chat keeps composer drafts.");
				}
				const { [sessionId]: previous, ...others } = provider.state.drafts;
				if ((previous?.text ?? "") === text) return;
				provider.setState({ drafts: text ? { ...others, [sessionId]: { text } } : others });
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
