import { definePlugin, type PluginSdk } from "@kilo-desktop/kernel";

import { Panes, WorkSessions } from "../contracts";

/** Where origin kept pinned session (or chat) ids, in the main window's localStorage. */
export const LEGACY_PINS_STORAGE_KEY = "kilo-ui.session-list-pins:v1";

function readLegacyPins(): string[] {
	try {
		const parsed: unknown = JSON.parse(localStorage.getItem(LEGACY_PINS_STORAGE_KEY) ?? "null");
		return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
	} catch {
		return [];
	}
}

/**
 * Main can't read the renderer's localStorage, so the main window hands
 * origin's pins over once; kilo.sessions applies them only the first time.
 */
function handOverLegacyPins(sdk: PluginSdk): void {
	const ids = readLegacyPins();
	if (ids.length === 0) return;
	sdk.domains.track(WorkSessions, {
		added: (sessions) => void sessions.methods.importLegacyPins({ ids }).catch(() => undefined),
		removed: () => {},
	});
}

/** Where origin kept each session's panes and layout, in the main window's localStorage. */
export const LEGACY_PANES_STORAGE_KEY = "kilo-ui:right-panel-state:v3";

function readLegacyPanes(): unknown {
	try {
		return JSON.parse(localStorage.getItem(LEGACY_PANES_STORAGE_KEY) ?? "null");
	} catch {
		return null;
	}
}

/**
 * Origin's panes, handed over once like the pins; kilo.sessions ignores later
 * hand-overs. Handed over even when origin saved none: origin showed every
 * session's chat without saving it, and the hand-over is when kilo.sessions
 * gives origin's sessions their agent panes.
 */
function handOverLegacyPanes(sdk: PluginSdk): void {
	const state = readLegacyPanes();
	sdk.domains.track(Panes, {
		added: (panes) => void panes.methods.importLegacy({ state }).catch(() => undefined),
		removed: () => {},
	});
}

/** kilo.sessions' renderer entry. */
export const sessionsWebEntry = definePlugin({
	activate(sdk) {
		if (sdk.context.get("kernel/secondaryWindow")) return;
		handOverLegacyPins(sdk);
		handOverLegacyPanes(sdk);
	},
});
