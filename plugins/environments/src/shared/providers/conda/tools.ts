import { z } from "zod";

import type { SDK } from "@anaconda-agentic-desktop/feature-sdk";

import {
	condaEnvsCreateInputSchema,
	condaEnvsDeleteInputSchema,
	condaPackagesInstallInputSchema,
	condaRepodataFindInputSchema,
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
			"The result is rendered as an interactive UI widget in the chat. " +
			"Do NOT repeat or summarize the tool output in your response — the user already sees it. " +
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
			"Delete a conda environment from the plugin-scoped base. This action " +
			"is irreversible — every package installed into the environment is removed. " +
			"Identify the environment by name or by prefix path.",
		inputSchema: z.toJSONSchema(condaEnvsDeleteInputSchema, { target: "draft-2020-12" }),
		validate: condaEnvsDeleteInputSchema,
		exposeToModelContext: true,
		annotations: { destructiveHint: true },
		handler: (args) => sdk.invoke("conda.envs.delete", args),
	});

	sdk.tools.register({
		name: "conda.packages.install",
		description:
			"Install one or more packages into an EXISTING conda environment " +
			"(use conda.envs.create instead to make a new environment). Identify " +
			"the environment by name or by prefix path, and pass one or more raw " +
			'conda MatchSpec strings (e.g. "faker", "numpy>=1.24", ' +
			'"conda-forge::pandas"). Optionally restrict solving to specific ' +
			"channels. Adds state (not destructive); fails with SOLVE_FAILED when " +
			"the requested specs cannot be satisfied. Call conda.repodata.find " +
			"first if you need to confirm a package or version is available.",
		inputSchema: z.toJSONSchema(condaPackagesInstallInputSchema, { target: "draft-2020-12" }),
		validate: condaPackagesInstallInputSchema,
		exposeToModelContext: true,
		handler: (args) => sdk.invoke("conda.packages.install", args),
	});

	sdk.tools.register({
		name: "conda.channels.list",
		description:
			"List the conda channels configured for the plugin-scoped base, in solver " +
			"priority order (highest priority first). Use this to inspect which package " +
			"sources are active before installing packages or diagnosing channel-related " +
			"solve failures. Returns an ordered array of channel identifiers (short names " +
			'like "conda-forge", URLs, or file:// paths).',
		inputSchema: { type: "object", properties: {}, additionalProperties: false },
		annotations: { readOnlyHint: true },
		exposeToModelContext: true,
		handler: () => sdk.invoke("conda.channels.list"),
	});

	sdk.tools.register({
		name: "conda.repodata.find",
		description:
			"Look up available conda packages in the channel repodata index. " +
			"`names` filters by EXACT package name (there is no substring or " +
			"wildcard matching) — omit it only to walk the whole index, which is " +
			"slow and returns thousands of packages. Optionally narrow by " +
			"`channels` and platform `subdirs`. Each result aggregates one package: " +
			"`version` is the newest available version, `build` is that version's " +
			"build number, and `versions` lists every version with its size. " +
			"Results are capped at `limit` (default 100) and `truncated` is true " +
			"when more existed. Use this to check whether a package (or a specific " +
			"version of it) is installable before calling conda.packages.install.",
		inputSchema: z.toJSONSchema(condaRepodataFindInputSchema, { target: "draft-2020-12" }),
		validate: condaRepodataFindInputSchema,
		annotations: { readOnlyHint: true },
		exposeToModelContext: true,
		handler: (args) => sdk.invoke("conda.repodata.find", args),
	});
}
