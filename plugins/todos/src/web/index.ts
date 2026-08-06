/**
 * Renderer entry for the todos plugin.
 *
 * `TodoList` is the page component named by the manifest route (plugin.json
 * `routes[].component`) — the shell resolves it from this module and mounts
 * it when /todos is visited. The plugin never imports the router; navigation
 * happens through `sdk.navigate` (Decision #19).
 *
 * `TodoNavIcon` is the nav icon component named by the manifest nav entry
 * (plugin.json `nav[].icon`) — the shell resolves it from this module and
 * renders it in the sidebar.
 *
 * `webRegister` is the plugin's renderer-side boot hook — it runs in both
 * browser and Electron modes (unlike `browserRegister` which is browser-only)
 * so the plugin can register its own WebMCP tools without any central-file
 * edits. See issue #74 for the plugin-authored-tools rationale.
 *
 * Electron-only (Decision #7): there is deliberately no `browserRegister` —
 * the backend needs SQLite in the main process, so standalone browser mode
 * skips this plugin with the standard warning and the shell renders an
 * explicit unavailable state for the /todos route. Tool handlers still fail
 * loudly in browser mode because `sdk.invoke` has no in-process backend.
 */
import type { SDK } from "@anaconda-agentic-desktop/feature-sdk";
import { z } from "zod";

import { todosContract } from "../contracts/schemas.js";

export { TodoList } from "./TodoList.js";
export { TodoNavIcon } from "./TodoNavIcon.js";

export function webRegister(sdk: SDK): void {
	// The contract schemas are the single source of truth for both the JSON
	// Schema advertised to MCP clients and the boundary validator run before
	// the handler; the main-process handler re-validates via the same contract.
	const addInput = todosContract.add.input;
	const toggleInput = todosContract.toggle.input;

	sdk.tools.register({
		name: "list",
		description: "List all todo items with their id, title, and completed state.",
		inputSchema: { type: "object", properties: {}, additionalProperties: false },
		annotations: { readOnlyHint: true },
		exposeToModelContext: true,
		handler: () => sdk.invoke("list"),
	});

	sdk.tools.register({
		name: "add",
		description: "Create a new todo item with the given title.",
		inputSchema: z.toJSONSchema(addInput, { target: "draft-2020-12" }),
		validate: addInput,
		exposeToModelContext: true,
		handler: (args) => sdk.invoke("add", args),
	});

	sdk.tools.register({
		name: "toggle",
		description: "Toggle the completed state of the todo item with the given id.",
		inputSchema: z.toJSONSchema(toggleInput, { target: "draft-2020-12" }),
		validate: toggleInput,
		exposeToModelContext: true,
		handler: (args) => sdk.invoke("toggle", args),
	});
}
