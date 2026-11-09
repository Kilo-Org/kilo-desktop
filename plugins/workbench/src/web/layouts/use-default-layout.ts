import { useContextKey, useDomain } from "@kilo-desktop/kernel/web";
import { Panes } from "@kilo-desktop/plugin-sessions/contracts";

import { Layouts } from "../../contracts";
import { reportFailure } from "../list/session-row-actions";
import { sessionPanesOf } from "../panes/pane-actions";
import { usePaneKinds } from "../panes/use-pane-kinds";
import { applyLayoutTemplate } from "./layout-template";

/** kilo.flags' context key for the flag that turns layout presets on. */
export const CHAT_LAYOUTS_FLAG_KEY = "kilo.flags/flag:chat-layouts";

/**
 * Applies the default preset to a session the launcher just created with no
 * pane chosen, as origin gave each new, still empty session one default
 * layout. A failure leaves the session empty and is reported on its own.
 */
export function useDefaultLayout(): (sessionId: string) => Promise<void> {
	const enabled = useContextKey(CHAT_LAYOUTS_FLAG_KEY);
	const layouts = useDomain(Layouts);
	const panes = useDomain(Panes);
	const kinds = usePaneKinds();
	return async (sessionId) => {
		if (!enabled || !layouts || !panes) return;
		const { presets, defaultPresetId } = layouts.getState();
		const preset = presets.find((entry) => entry.id === defaultPresetId);
		if (!preset || sessionPanesOf(panes, sessionId).panes.length > 0) return;
		await applyLayoutTemplate(panes, sessionId, preset.template, kinds).catch(
			reportFailure("Could not apply the default layout", "The session started empty."),
		);
	};
}
