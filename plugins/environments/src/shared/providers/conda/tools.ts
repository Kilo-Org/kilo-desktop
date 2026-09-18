import { z } from "zod";

import type { SDK } from "@kilo-desktop/feature-sdk";

import {
	condaEnvsCloneInputSchema,
	condaEnvsCreateFromFileInputSchema,
	condaEnvsCreateInputSchema,
	condaEnvsDeleteInputSchema,
	condaPackagesInstallInputSchema,
	condaPackagesListInputSchema,
	condaPackagesRemoveInputSchema,
	condaPackagesUpdateInputSchema,
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

	// The MCP-exposed schema omits `prefix` so LLMs cannot target arbitrary
	// filesystem locations. The UI channel handler accepts the full schema.
	const mcpCreateSchema = condaEnvsCreateInputSchema.omit({ prefix: true });
	sdk.tools.register({
		name: "conda.envs.create",
		description:
			"Create a new named conda environment inside the plugin-scoped base. " +
			"Optionally installs packages from the given channels during creation. " +
			"Fails with ENV_EXISTS if the name is already in use.",
		inputSchema: z.toJSONSchema(mcpCreateSchema, { target: "draft-2020-12" }),
		validate: mcpCreateSchema,
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
		name: "conda.envs.clone",
		description:
			"Clone an existing conda environment into a new named environment. " +
			"The new environment receives an exact copy of all packages from the source.",
		inputSchema: z.toJSONSchema(condaEnvsCloneInputSchema, { target: "draft-2020-12" }),
		validate: condaEnvsCloneInputSchema,
		exposeToModelContext: true,
		handler: (args) => sdk.invoke("conda.envs.clone", args),
	});

	// createFromFile accepts an unconstrained filesystem path — intentionally
	// NOT exposed to the model context so an LLM cannot invoke it with
	// arbitrary paths. The renderer UI provides paths only from the trusted
	// native file picker or Electron's getPathForFile (drag-and-drop).
	sdk.tools.register({
		name: "conda.envs.createFromFile",
		description:
			"Create a conda environment from a YAML environment file (.yml/.yaml). " +
			"Optionally override the name declared in the file by passing a `name` parameter.",
		inputSchema: z.toJSONSchema(condaEnvsCreateFromFileInputSchema, { target: "draft-2020-12" }),
		validate: condaEnvsCreateFromFileInputSchema,
		handler: (args) => sdk.invoke("conda.envs.createFromFile", args),
	});

	sdk.tools.register({
		name: "conda.packages.list",
		description:
			"List all packages installed in a conda environment, including " +
			"pip-installed packages. Identify the environment by name or by " +
			"prefix path. Each package includes name, version, build string, " +
			'and source channel. Pip-installed packages have channel "pypi".',
		inputSchema: z.toJSONSchema(condaPackagesListInputSchema, { target: "draft-2020-12" }),
		validate: condaPackagesListInputSchema,
		annotations: { readOnlyHint: true },
		exposeToModelContext: true,
		handler: (args) => sdk.invoke("conda.packages.list", args),
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
		name: "conda.packages.remove",
		description:
			"Remove (uninstall) one or more packages from an EXISTING conda " +
			"environment. Identify the environment by name or by prefix path, and " +
			'pass one or more package names (e.g. "faker", "numpy"). This is ' +
			"DESTRUCTIVE — it uninstalls the named packages and any now-orphaned " +
			"dependencies; fails with SOLVE_FAILED when the removal cannot be " +
			"satisfied (e.g. another installed package still requires it).",
		inputSchema: z.toJSONSchema(condaPackagesRemoveInputSchema, { target: "draft-2020-12" }),
		validate: condaPackagesRemoveInputSchema,
		annotations: { destructiveHint: true },
		exposeToModelContext: true,
		handler: (args) => sdk.invoke("conda.packages.remove", args),
	});

	sdk.tools.register({
		name: "conda.packages.update",
		description:
			"Update packages in an EXISTING conda environment. Identify the " +
			"environment by name or by prefix path. Two mutually exclusive modes: " +
			'pass `packages` (one or more names/MatchSpecs, e.g. "numpy", ' +
			'"conda-forge::pandas") to update just those, or set `updateAll: true` ' +
			"(with no `packages`) to update every package in the environment. " +
			"A version-less package updates to the newest version COMPATIBLE with " +
			"the environment's existing constraints (not an unconditional jump to " +
			'the absolute latest); pin a version like "numpy=1.26" to constrain it. ' +
			"Optionally restrict solving to specific channels. WARNING: updating can " +
			"BREAK the environment — it REPLACES installed package versions and the " +
			"solver may relink or downgrade other packages and their dependencies to " +
			"keep the environment consistent, which can make packages that relied on " +
			"the previous versions stop working. This applies to a single targeted " +
			"package as much as to updateAll, so warn the user before proceeding. " +
			"Fails with SOLVE_FAILED when the update cannot be satisfied.",
		inputSchema: z.toJSONSchema(condaPackagesUpdateInputSchema, { target: "draft-2020-12" }),
		validate: condaPackagesUpdateInputSchema,
		annotations: { destructiveHint: true },
		exposeToModelContext: true,
		handler: (args) => sdk.invoke("conda.packages.update", args),
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
			"`names` filters by EXACT package name; `query` does case-insensitive " +
			"partial matching (results ranked exact > prefix > substring). Use one " +
			"or the other, not both. Omit both only to walk the whole index, which " +
			"is slow and returns thousands of packages. Optionally narrow by " +
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
