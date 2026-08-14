import type { SDK } from "@anaconda-agentic-desktop/feature-sdk";

/**
 * Register provider-scoped WebMCP tools for the conda provider. Called by
 * both `webRegister` and `CondaProvider.registerTools` — lives in `shared/`
 * because it depends only on the SDK interface, not on main or web internals.
 *
 * Sub-issue 4 exposes only `conda.envs.list` (`readOnlyHint: true`) — it
 * proves the full renderer-side pipeline (tool → sdk.invoke → main
 * handler → CondaService → conda subprocess) with the safest op.
 * Mutating tools (`conda.envs.create`, `conda.packages.install`, ...)
 * land in sub-issues 6 – 8 with `destructiveHint`/`readOnlyHint`
 * annotations calibrated to their real behaviour. Their JSON Schemas will
 * derive from `condaContract` via `z.toJSONSchema(...)` — the same
 * pattern the todos plugin follows in `plugins/todos/src/web/index.ts`.
 *
 * Tool names carry the full `conda.envs.list` shape so the wire name a
 * host advertises to MCP clients (`environments_conda_envs_list`) stays
 * consistent with the provider seam and the contract keys — no rename
 * layer between contracts and tools.
 */
export function registerCondaTools(sdk: SDK): void {
	sdk.tools.register({
		name: "conda.envs.list",
		description:
			"List conda environments available in the plugin-scoped base. Returns each " +
			"environment's on-disk prefix and name (base envs surface with an empty name).",
		inputSchema: { type: "object", properties: {}, additionalProperties: false },
		annotations: { readOnlyHint: true },
		exposeToModelContext: true,
		handler: () => sdk.invoke("conda.envs.list"),
	});
}
