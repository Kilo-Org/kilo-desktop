/**
 * WebMCP tools that surface open chat notebooks and open scratch or file-backed
 * notebooks in the kilo-ui right panel. Cross-plugin access goes through
 * `sdk.plugins.get("kilo-ui")` — no kilo-ui source imports.
 *
 * Tool descriptions are the model-facing contract: create and show stay in this
 * panel. nteract MCP is for cells, kernel, and save only.
 */
import type { SDK } from "@anaconda-agentic-desktop/feature-sdk";
import { z } from "zod";

import {
	notebookContract,
	notebookOpenFileResultSchema,
	type NotebookOpenFileResult,
} from "../../contracts/schemas.js";

import {
	NOTEBOOK_ID_METADATA_KEY,
	NOTEBOOK_OPEN_ERROR_METADATA_KEY,
	NOTEBOOK_OPEN_STATE_METADATA_KEY,
	NOTEBOOK_PATH_METADATA_KEY,
	NOTEBOOK_TAB_DEFINITION_ID,
	NOTEBOOK_TAB_TITLE,
	notebookIdFromTab,
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
			readonly transient?: boolean;
		},
	): { readonly instanceId: string; readonly title: string };
	updateTab(
		sessionId: string,
		instanceId: string,
		update: {
			readonly title?: string;
			readonly iconKey?: string;
			readonly metadata?: Readonly<Record<string, string>>;
			readonly dirty?: boolean;
			readonly transient?: boolean;
		},
	): void;
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

function basename(filePath: string): string {
	return filePath.replaceAll("\\", "/").split("/").at(-1) ?? filePath;
}

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

export type NotebookPanelOpenFileResult =
	| {
			readonly sessionId: string;
			readonly notebook_id: string;
			readonly title: string;
			readonly path: string;
	  }
	| { readonly error: string };

async function openNotebookFileWithPanel(
	sdk: SDK,
	notebookPath: string,
	sessionId: string,
	panel: ChatRightPanelCapability,
): Promise<NotebookPanelOpenFileResult> {
	panel.show(sessionId);
	const existing = panel
		.listTabs(sessionId)
		.find(
			(tab) =>
				tab.definitionId === NOTEBOOK_TAB_DEFINITION_ID &&
				tab.metadata?.[NOTEBOOK_PATH_METADATA_KEY] === notebookPath,
		);
	const existingNotebookId = existing
		? notebookIdFromTab(existing.instanceId, existing.metadata)
		: undefined;
	if (existing && existingNotebookId) {
		const tab = panel.openContributedTab(
			sessionId,
			{ id: NOTEBOOK_TAB_DEFINITION_ID, title: NOTEBOOK_TAB_TITLE },
			{
				instanceId: existing.instanceId,
				title: existing.title,
				...(existing.metadata ? { metadata: existing.metadata } : {}),
			},
		);
		return {
			sessionId,
			notebook_id: existingNotebookId,
			title: tab.title,
			path: notebookPath,
		};
	}
	const openingMetadata = {
		[NOTEBOOK_PATH_METADATA_KEY]: notebookPath,
		[NOTEBOOK_OPEN_STATE_METADATA_KEY]: "opening",
	};
	const tab = panel.openContributedTab(
		sessionId,
		{ id: NOTEBOOK_TAB_DEFINITION_ID, title: NOTEBOOK_TAB_TITLE },
		{
			...(existing ? { instanceId: existing.instanceId } : {}),
			title: existing?.title ?? basename(notebookPath),
			metadata: openingMetadata,
			transient: true,
		},
	);

	let openedFile: NotebookOpenFileResult;
	try {
		openedFile = notebookOpenFileResultSchema.parse(
			await sdk.invoke("openFile", { path: notebookPath }),
		);
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "The notebook file could not be opened.";
		panel.updateTab(sessionId, tab.instanceId, {
			transient: false,
			metadata: {
				[NOTEBOOK_PATH_METADATA_KEY]: notebookPath,
				[NOTEBOOK_OPEN_STATE_METADATA_KEY]: "error",
				[NOTEBOOK_OPEN_ERROR_METADATA_KEY]: message,
			},
		});
		return {
			error: message,
		};
	}

	panel.updateTab(sessionId, tab.instanceId, {
		title: openedFile.title,
		transient: false,
		metadata: {
			[NOTEBOOK_PATH_METADATA_KEY]: openedFile.path,
			[NOTEBOOK_ID_METADATA_KEY]: openedFile.notebookId,
			[NOTEBOOK_OPEN_STATE_METADATA_KEY]: "ready",
		},
	});
	return {
		sessionId,
		notebook_id: openedFile.notebookId,
		title: openedFile.title,
		path: openedFile.path,
	};
}

export async function openNotebookFileInSession(
	sdk: SDK,
	notebookPath: string,
	sessionId: string,
): Promise<NotebookPanelOpenFileResult> {
	const panelOrError = resolvePanel(sdk);
	if ("error" in panelOrError) return panelOrError;
	return openNotebookFileWithPanel(sdk, notebookPath, sessionId, panelOrError);
}

export async function openNotebookFileInPanel(
	sdk: SDK,
	notebookPath: string,
): Promise<NotebookPanelOpenFileResult> {
	const panelOrError = resolvePanel(sdk);
	if ("error" in panelOrError) return panelOrError;
	const sessionOrError = resolveFocusedSession(panelOrError);
	if ("error" in sessionOrError) return sessionOrError;
	return openNotebookFileWithPanel(sdk, notebookPath, sessionOrError.sessionId, panelOrError);
}

/**
 * Model-facing policy for desktop notebook tools. Kilo surfaces these
 * descriptions in the tool list, so this is how we steer the agent away from
 * nteract MCP create/show (which open the external nteract app).
 */
const DESKTOP_NOTEBOOK_PANEL_POLICY =
	"Never create or show a notebook in the external nteract app. " +
	"Do not call notebooks_create_notebook, notebooks_show_notebook, or notebooks_open_notebook. " +
	"Always use these desktop notebook tools to open the notebook in the chat right-hand side panel.";

export function registerNotebookWebMcpTools(sdk: SDK): void {
	sdk.tools.register({
		name: "list_open",
		description:
			"List notebooks open in the focused chat's right-hand side panel. " +
			DESKTOP_NOTEBOOK_PANEL_POLICY +
			" Each notebook_id is the id to pass to notebooks_* cell, kernel, and save tools. " +
			"Call this to see which notebooks are already open before creating another.",
		inputSchema: { type: "object", properties: {}, additionalProperties: false },
		annotations: { readOnlyHint: true },
		exposeToModelContext: true,
		handler: () => listOpenNotebooks(sdk),
	});

	sdk.tools.register({
		name: "open",
		description:
			"Open a new notebook in the focused chat's right-hand side panel and return its " +
			"notebook_id (a bare UUID). " +
			DESKTOP_NOTEBOOK_PANEL_POLICY +
			" Call this instead of notebooks_create_notebook or notebooks_show_notebook. " +
			"After it returns, use notebooks_* tools only for cells, kernel, and save — pass the " +
			"notebook_id unchanged. If connect fails immediately after open, retry with the same " +
			"notebook_id (the panel iframe may still be finishing its handshake).",
		inputSchema: { type: "object", properties: {}, additionalProperties: false },
		exposeToModelContext: true,
		handler: () => openNotebookInPanel(sdk),
	});

	const openFileInput = notebookContract.openFile.input;
	sdk.tools.register({
		name: "open_file",
		description:
			"Open an existing .ipynb file in the focused chat's right-hand side panel. " +
			DESKTOP_NOTEBOOK_PANEL_POLICY +
			" Pass an absolute file path. Returns the daemon notebook_id to use unchanged with " +
			"notebooks_* cell, kernel, and save tools. Reopening the same file focuses its existing tab.",
		inputSchema: z.toJSONSchema(openFileInput, { target: "draft-2020-12" }),
		validate: openFileInput,
		exposeToModelContext: true,
		handler: (args) => openNotebookFileInPanel(sdk, openFileInput.parse(args).path),
	});
}
