/**
 * WebMCP tools that surface open chat notebooks and open a scratch notebook
 * in the kilo-ui right panel. Cross-plugin access goes through
 * `sdk.plugins.get("kilo-ui")` — no kilo-ui source imports.
 */
import type { SDK } from "@anaconda-agentic-desktop/feature-sdk";

import {
	NOTEBOOK_TAB_DEFINITION_ID,
	NOTEBOOK_TAB_TITLE,
	selectNotebookTabs,
	type ChatRightPanelNotebookTab,
	type ChatRightPanelTabSnapshot,
} from "./notebook-tabs.js";

export {
	NOTEBOOK_TAB_DEFINITION_ID,
	NOTEBOOK_TAB_TITLE,
	type ChatRightPanelNotebookTab,
} from "./notebook-tabs.js";

/** Structural capability shape from kilo-ui — asserted, not imported. */
export type ChatRightPanelCapability = {
	getFocusedSessionId(): string | null;
	listTabs(sessionId: string): readonly ChatRightPanelTabSnapshot[];
	getActiveTabId(sessionId: string): string | null;
	openContributedTab(
		sessionId: string,
		definition: { readonly id: string; readonly title: string },
	): { readonly instanceId: string; readonly title: string };
	setTabDirty?(sessionId: string, instanceId: string, dirty: boolean): void;
	registerTabLifecycle?(
		sessionId: string,
		instanceId: string,
		lifecycle: {
			readonly save?: () => Promise<{
				readonly outcome: "saved" | "cancelled" | "failed";
				readonly reason?: string | undefined;
			}>;
			readonly discard?: () => Promise<void>;
		},
	): () => void;
	show(sessionId: string): void;
};

export type ChatRightPanelCapabilities = {
	readonly chatRightPanel: ChatRightPanelCapability;
};

const NO_FOCUSED_SESSION =
	"No focused chat session. Open a chat in the app before using notebook panel tools.";

const KILO_UI_UNAVAILABLE =
	"kilo-ui chat right panel is unavailable. The chat UI plugin may not be loaded.";

function resolvePanel(sdk: SDK): ChatRightPanelCapability | { error: string } {
	const panel = sdk.plugins.get<ChatRightPanelCapabilities>("kilo-ui")?.chatRightPanel;
	if (!panel) return { error: KILO_UI_UNAVAILABLE };
	return panel;
}

function resolveFocusedSession(
	panel: ChatRightPanelCapability,
): { sessionId: string } | { error: string } {
	const sessionId = panel.getFocusedSessionId();
	if (!sessionId) return { error: NO_FOCUSED_SESSION };
	return { sessionId };
}

export function listOpenNotebooks(sdk: SDK): {
	readonly sessionId: string | null;
	readonly notebooks: readonly ChatRightPanelNotebookTab[];
	readonly error?: string;
} {
	const panelOrError = resolvePanel(sdk);
	if ("error" in panelOrError) {
		return { sessionId: null, notebooks: [], error: panelOrError.error };
	}
	const sessionOrError = resolveFocusedSession(panelOrError);
	if ("error" in sessionOrError) {
		return { sessionId: null, notebooks: [], error: sessionOrError.error };
	}
	return {
		sessionId: sessionOrError.sessionId,
		notebooks: selectNotebookTabs(
			panelOrError.listTabs(sessionOrError.sessionId),
			panelOrError.getActiveTabId(sessionOrError.sessionId),
		),
	};
}

export function openNotebookInPanel(sdk: SDK):
	| {
			readonly sessionId: string;
			readonly notebook_id: string;
			readonly title: string;
	  }
	| { readonly error: string } {
	const panelOrError = resolvePanel(sdk);
	if ("error" in panelOrError) return panelOrError;
	const sessionOrError = resolveFocusedSession(panelOrError);
	if ("error" in sessionOrError) return sessionOrError;

	const { sessionId } = sessionOrError;
	panelOrError.show(sessionId);
	const tab = panelOrError.openContributedTab(sessionId, {
		id: NOTEBOOK_TAB_DEFINITION_ID,
		title: NOTEBOOK_TAB_TITLE,
	});
	const active = selectNotebookTabs(
		panelOrError.listTabs(sessionId),
		panelOrError.getActiveTabId(sessionId),
	).find((entry) => entry.active);
	return {
		sessionId,
		notebook_id: active?.notebook_id ?? tab.instanceId,
		title: active?.title ?? tab.title,
	};
}

export function registerNotebookWebMcpTools(sdk: SDK): void {
	sdk.tools.register({
		name: "list_open",
		description:
			"List scratch notebooks open in the focused chat's right-hand side panel. " +
			"Each notebook_id is the id to pass to runt / nteract MCP tools. " +
			"Call this to see which notebooks are already open before creating another.",
		inputSchema: { type: "object", properties: {}, additionalProperties: false },
		annotations: { readOnlyHint: true },
		exposeToModelContext: true,
		handler: () => listOpenNotebooks(sdk),
	});

	sdk.tools.register({
		name: "open",
		description:
			"Open a new recoverable scratch notebook in the focused chat's right-hand side panel " +
			"and return its notebook_id (a bare UUID). Call this BEFORE any runt / nteract MCP " +
			"commands (create/connect/edit cells). Pass the returned notebook_id unchanged to " +
			"those tools — do not strip or rewrite it. If nteract connect fails immediately " +
			"after open, retry with the same notebook_id (the panel iframe may still be " +
			"finishing its create_notebook handshake).",
		inputSchema: { type: "object", properties: {}, additionalProperties: false },
		exposeToModelContext: true,
		handler: () => openNotebookInPanel(sdk),
	});
}
