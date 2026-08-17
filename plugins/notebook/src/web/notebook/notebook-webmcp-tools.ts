/**
 * WebMCP tools that surface open chat notebooks and open scratch or file-backed
 * notebooks in the kilo-ui right panel. Cross-plugin access goes through
 * `sdk.plugins.get("kilo-ui")` — no kilo-ui source imports.
 */
import type { SDK } from "@anaconda-agentic-desktop/feature-sdk";
import { z } from "zod";

import {
	notebookContract,
	notebookOpenFileResultSchema,
	type NotebookOpenFileResult,
} from "../../contracts/schemas.js";

import {
	NOTEBOOK_PATH_METADATA_KEY,
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
		options?: {
			readonly instanceId?: string;
			readonly title?: string;
			readonly metadata?: Readonly<Record<string, string>>;
		},
	): { readonly instanceId: string; readonly title: string };
	setTabTitle?(sessionId: string, instanceId: string, title: string): void;
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

export async function openNotebookFileInPanel(
	sdk: SDK,
	notebookPath: string,
): Promise<
	| {
			readonly sessionId: string;
			readonly notebook_id: string;
			readonly title: string;
			readonly path: string;
	  }
	| { readonly error: string }
> {
	const panelOrError = resolvePanel(sdk);
	if ("error" in panelOrError) return panelOrError;
	const sessionOrError = resolveFocusedSession(panelOrError);
	if ("error" in sessionOrError) return sessionOrError;

	let openedFile: NotebookOpenFileResult;
	try {
		openedFile = notebookOpenFileResultSchema.parse(
			await sdk.invoke("openFile", { path: notebookPath }),
		);
	} catch (error) {
		return {
			error: error instanceof Error ? error.message : "The notebook file could not be opened.",
		};
	}

	const { sessionId } = sessionOrError;
	panelOrError.show(sessionId);
	const tab = panelOrError.openContributedTab(
		sessionId,
		{ id: NOTEBOOK_TAB_DEFINITION_ID, title: NOTEBOOK_TAB_TITLE },
		{
			instanceId: openedFile.notebookId,
			title: openedFile.title,
			metadata: { [NOTEBOOK_PATH_METADATA_KEY]: openedFile.path },
		},
	);
	return {
		sessionId,
		notebook_id: tab.instanceId,
		title: tab.title,
		path: openedFile.path,
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

	const openFileInput = notebookContract.openFile.input;
	sdk.tools.register({
		name: "open_file",
		description:
			"Open an existing .ipynb file in the focused chat's right-hand notebook panel. " +
			"Pass an absolute file path. Returns the daemon notebook_id to use unchanged with " +
			"runt / nteract MCP commands. Reopening the same file focuses its existing tab.",
		inputSchema: z.toJSONSchema(openFileInput, { target: "draft-2020-12" }),
		validate: openFileInput,
		exposeToModelContext: true,
		handler: (args) => openNotebookFileInPanel(sdk, openFileInput.parse(args).path),
	});
}
