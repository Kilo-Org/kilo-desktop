import { z } from "zod";

import type { SDK } from "@anaconda-agentic-desktop/feature-sdk";

import {
	condaEnvsCreateInputSchema,
	condaEnvsDeleteInputSchema,
} from "../../../contracts/providers/conda.js";

/**
 * Register provider-scoped WebMCP tools for the conda provider. Called by
 * both `webRegister` and `CondaProvider.registerTools` — lives in `shared/`
 * because it depends only on the SDK interface, not on main or web internals.
 *
 * Sub-issue 4 exposed `conda.envs.list` (readOnly). Sub-issue 6 adds
 * the first two mutating tools:
 *
 * - `conda.envs.create` — creates a named env inside the plugin-scoped
 *   base. Not `destructiveHint` (creation adds state, does not remove
 *   it), not idempotent (creating an env that already exists errors
 *   with `ENV_EXISTS`).
 * - `conda.envs.delete` — `destructiveHint: true` because removal is
 *   irreversible; MCP clients should surface a confirmation prompt
 *   before invoking.
 *
 * Every tool JSON Schema derives from the contract's Zod input schema
 * via `z.toJSONSchema` (the same pattern the todos plugin uses in
 * `plugins/todos/src/web/index.ts`) so the wire-level MCP schema and
 * the boundary validator stay in lockstep.
 *
 * Tool names carry the full contract key (`conda.envs.create`, ...) so
 * the wire name a host advertises to MCP clients
 * (`environments_conda_envs_create`) matches the provider seam and the
 * contract keys — no rename layer between contracts and tools.
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

	sdk.tools.register({
		name: "conda.envs.create",
		description:
			"Create a new named conda environment inside the plugin-scoped base. " +
			"Optionally installs packages from the given channels during creation. " +
			"Fails with ENV_EXISTS if the name is already in use.",
		inputSchema: z.toJSONSchema(condaEnvsCreateInputSchema, { target: "draft-2020-12" }),
		validate: condaEnvsCreateInputSchema,
		exposeToModelContext: true,
		handler: (args) => sdk.invoke("conda.envs.create", args),
	});

	sdk.tools.register({
		name: "conda.envs.delete",
		description:
			"Delete a named conda environment from the plugin-scoped base. This action " +
			"is irreversible — every package installed into the environment is removed.",
		inputSchema: z.toJSONSchema(condaEnvsDeleteInputSchema, { target: "draft-2020-12" }),
		validate: condaEnvsDeleteInputSchema,
		annotations: { destructiveHint: true },
		exposeToModelContext: true,
		handler: (args) => sdk.invoke("conda.envs.delete", args),
	});
}
