import { useContextKey, useDomainObject } from "@kilo-desktop/kernel/web";

import { CHAT_LAYOUTS_FLAG_KEY, LayoutPresets, Panes } from "../../contracts";
import { applyLayoutTemplate } from "../layouts/layout-template";
import { sessionPanesOf } from "./pane-actions";
import { usePaneKinds } from "./pane-kinds";
import { reportFailure } from "./report-failure";

/**
 * Applies the default preset to a work session the New Session page just
 * created with no pane chosen, as origin gave each new, still empty session
 * one default layout. A failure leaves the work session empty and is
 * reported on its own.
 */
export function useDefaultLayout(): (workSessionId: string) => Promise<void> {
	const enabled = useContextKey(CHAT_LAYOUTS_FLAG_KEY);
	const presets = useDomainObject(LayoutPresets);
	const panes = useDomainObject(Panes);
	const kinds = usePaneKinds();
	return async (workSessionId) => {
		if (!enabled || !presets || !panes) return;
		const { presets: saved, defaultPresetId } = presets.getState();
		const preset = saved.find((entry) => entry.id === defaultPresetId);
		if (!preset || sessionPanesOf(panes, workSessionId).panes.length > 0) return;
		await applyLayoutTemplate(panes, workSessionId, preset.template, kinds).catch(
			reportFailure("Could not apply the default layout", "The session started empty."),
		);
	};
}
