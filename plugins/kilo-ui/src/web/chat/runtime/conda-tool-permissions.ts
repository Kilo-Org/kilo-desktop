import type { PermissionRuleset } from "@kilocode/sdk/v2/client";

/**
 * Kilo-visible names of the **mutating** conda tools.
 *
 * The WebMCP tools are served over the `desktop` MCP relay, so Kilo prefixes
 * every tool name with the server id (`desktop_` — see
 * `plugins/kilo-server/src/main/kilo-caller-context-plugin.ts`). The
 * unprefixed suffix is the wire name the environments plugin registers
 * (`<featureId>_<contractKey>`, e.g. `environments_conda_envs_create`).
 *
 * Source of truth for which conda tools mutate state:
 * `plugins/environments/src/shared/providers/conda/tools.ts` — the tools that
 * set `exposeToModelContext: true` and change environments, packages, or the
 * configured channels (`create`, `delete`, `clone`, `install`, `remove`,
 * `update`, `channels.add`, `channels.remove`). Channel changes are gated
 * because they alter what every later install trusts. The read-only
 * tools (`envs.list`, `packages.list`, `channels.list`, `repodata.find`) are
 * deliberately **not** listed: they stay prompt-free.
 *
 * This list is duplicated here because the chat shell cannot import another
 * plugin's runtime values; keep it in sync when that file changes. The exact
 * set is pinned by `conda-tool-permissions.test.ts`.
 */
export const MUTATING_CONDA_TOOL_NAMES = [
	"desktop_environments_conda_envs_create",
	"desktop_environments_conda_envs_delete",
	"desktop_environments_conda_envs_clone",
	"desktop_environments_conda_packages_install",
	"desktop_environments_conda_packages_remove",
	"desktop_environments_conda_packages_update",
	"desktop_environments_conda_channels_add",
	"desktop_environments_conda_channels_remove",
] as const;

/**
 * Session permission rules that require **per-action user approval** (`ask`)
 * before the agent runs a mutating conda tool. Kilo pauses the tool call and
 * the chat surfaces a permission prompt; the tool only executes once the user
 * approves. Non-mutating tools are unaffected.
 */
export function buildMutatingCondaPermissionRules(): PermissionRuleset {
	return MUTATING_CONDA_TOOL_NAMES.map((permission) => ({
		permission,
		pattern: "*",
		action: "ask" as const,
	}));
}

/** Conda-family CLIs whose mutating subcommands install/remove packages. */
const CONDA_CLI_BINARIES = ["conda", "mamba", "micromamba"] as const;

/** Top-level mutating subcommands on every conda-family CLI. */
const CONDA_CLI_MUTATING_SUBCOMMANDS = [
	"install",
	"create",
	"update",
	"upgrade",
	"remove",
	"uninstall",
] as const;

/** Mutating subcommands under the `env` namespace (`conda env create` …). */
const CONDA_CLI_ENV_MUTATING_SUBCOMMANDS = ["create", "update", "remove"] as const;

/** `<binary> <subcommand>` tokens whose presence marks a mutating conda CLI call. */
function condaCliMutationFragments(): string[] {
	const fragments = new Set<string>();
	for (const binary of CONDA_CLI_BINARIES) {
		for (const subcommand of CONDA_CLI_MUTATING_SUBCOMMANDS) {
			fragments.add(`${binary} ${subcommand}`);
		}
		for (const subcommand of CONDA_CLI_ENV_MUTATING_SUBCOMMANDS) {
			fragments.add(`${binary} env ${subcommand}`);
		}
	}
	return [...fragments];
}

function condaCliMutationPatterns(): string[] {
	// `*<fragment>*` so an absolute binary path (`/opt/anaconda3/bin/conda`) and a
	// compound command (`cd x && conda install …`) still match.
	return condaCliMutationFragments().map((fragment) => `*${fragment}*`);
}

/**
 * Whether a `bash` command matches one of the mutating conda-CLI patterns
 * above — i.e. the agent is running a conda mutation through the shell rather
 * than the gated MCP tools. Mirrors the `*<fragment>*` glob so the UI can treat
 * such a permission request as per-action-only (no standing "Always allow").
 */
export function matchesMutatingCondaCli(command: string): boolean {
	return condaCliMutationFragments().some((fragment) => command.includes(fragment));
}

/**
 * Session permission rules requiring **per-action user approval** (`ask`)
 * before the agent runs a mutating conda-family command through `bash`.
 *
 * The MCP conda tools are gated above, but the agent can instead shell out to
 * `conda`/`mamba`/`micromamba` (e.g. to install a local package file the tool
 * refuses), and bash is otherwise auto-allowed — so the CLI path would run a
 * privileged install with no prompt. These rules close that substitution gap.
 *
 * Command-string matching is bypassable (wrappers, `sh -c`, aliases); this is
 * the app-side prompt, not a boundary. Pair with the bridge policy (gate 4),
 * isolation (gate 3), and agent-shell PATH/env scrubbing where available.
 */
export function buildCondaCliPermissionRules(): PermissionRuleset {
	return condaCliMutationPatterns().map((pattern) => ({
		permission: "bash",
		pattern,
		action: "ask" as const,
	}));
}
