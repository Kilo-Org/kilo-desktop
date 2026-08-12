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
 * Feature-flag gate (`todo-feature`): tool registration is bound to the flag
 * via `sdk.featureFlags.subscribe` so the LLM only sees the tools while the
 * flag is on. A live toggle flips them on/off without a restart. The UI and
 * the main-process handlers gate themselves on the same flag.
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

/**
 * LaunchDarkly feature-flag key. Kept in sync with `FEATURE_FLAG_KEY` in
 * `plugins/todos/src/main/index.ts` and `plugins/todos/src/web/TodoList.tsx`.
 */
export const FEATURE_FLAG_KEY = "todo-feature";

/**
 * Register the three todo tools and return a disposer that unregisters them
 * atomically. Idempotent per call; caller owns the lifecycle.
 */
function registerTodoTools(sdk: SDK): () => void {
	// The contract schemas are the single source of truth for both the JSON
	// Schema advertised to MCP clients and the boundary validator run before
	// the handler; the main-process handler re-validates via the same contract.
	const addInput = todosContract.add.input;
	const toggleInput = todosContract.toggle.input;

	const unregisterList = sdk.tools.register({
		name: "list",
		description: "List all todo items with their id, title, and completed state.",
		inputSchema: { type: "object", properties: {}, additionalProperties: false },
		annotations: { readOnlyHint: true },
		exposeToModelContext: true,
		handler: () => sdk.invoke("list"),
	});

	const unregisterAdd = sdk.tools.register({
		name: "add",
		description: "Create a new todo item with the given title.",
		inputSchema: z.toJSONSchema(addInput, { target: "draft-2020-12" }),
		validate: addInput,
		exposeToModelContext: true,
		handler: (args) => sdk.invoke("add", args),
	});

	const unregisterToggle = sdk.tools.register({
		name: "toggle",
		description: "Toggle the completed state of the todo item with the given id.",
		inputSchema: z.toJSONSchema(toggleInput, { target: "draft-2020-12" }),
		validate: toggleInput,
		exposeToModelContext: true,
		handler: (args) => sdk.invoke("toggle", args),
	});

	return () => {
		unregisterList();
		unregisterAdd();
		unregisterToggle();
	};
}

export function webRegister(sdk: SDK): void {
	// Bind tool registration to the feature flag. `subscribe` fires
	// synchronously with the current cache (`{}` before flags resolve), so
	// the first call runs with the flag off; the tools only appear once the
	// host reports the flag as on. A later toggle reruns this closure and we
	// install/tear down accordingly, mirroring how anaconda-mcp reconciles
	// on `feature-flag.changed`.
	let dispose: (() => void) | null = null;
	sdk.featureFlags.subscribe((flags) => {
		const enabled = Boolean(flags[FEATURE_FLAG_KEY] ?? false);
		if (enabled && !dispose) {
			dispose = registerTodoTools(sdk);
		} else if (!enabled && dispose) {
			dispose();
			dispose = null;
		}
	});
}
