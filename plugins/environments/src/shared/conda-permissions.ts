import { toolWireName, type PermissionRule } from "@kilo-desktop/plugin-core/contracts";

import { ENVIRONMENTS_PLUGIN_ID, MUTATING_CONDA_TOOL_IDS } from "../contracts/index";

/**
 * The conda tools that change environments, packages or the configured
 * channels (channel changes alter what every later install trusts). Their
 * `kilo.core/tool` contributions ask before each call (`approval: "ask"`);
 * the read-only tools stay prompt-free.
 */
export { MUTATING_CONDA_TOOL_IDS };
export type MutatingCondaToolId = (typeof MUTATING_CONDA_TOOL_IDS)[number];

/** The name Kilo knows a conda tool by (`desktop_environments_conda_envs_create`). */
export function condaToolName(id: string): string {
	return toolWireName(`${ENVIRONMENTS_PLUGIN_ID}/${id}`);
}

/** Kilo's names for the mutating conda tools. */
export const MUTATING_CONDA_TOOL_NAMES: readonly string[] =
	MUTATING_CONDA_TOOL_IDS.map(condaToolName);

const ACTION_LABELS: Readonly<Record<MutatingCondaToolId, string>> = {
	"conda.envs.create": "creating a conda environment",
	"conda.envs.delete": "deleting a conda environment",
	"conda.envs.clone": "cloning a conda environment",
	"conda.packages.install": "installing conda packages",
	"conda.packages.remove": "removing conda packages",
	"conda.packages.update": "updating conda packages",
	"conda.channels.add": "adding a conda channel",
	"conda.channels.remove": "removing a conda channel",
};

/** The action a permission card's title names for a mutating conda tool ("Allow installing conda packages?"). */
export function condaPermissionAction(toolName: string): string | undefined {
	const id = MUTATING_CONDA_TOOL_IDS.find((candidate) => condaToolName(candidate) === toolName);
	return id ? ACTION_LABELS[id] : undefined;
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

/** What the running Kilo server calls its shell tool and permission. */
export type ShellPermissionName = "shell" | "bash";

/**
 * The running Kilo server's own name for its shell permission, from the
 * version kilo.core reports: Kilo v2 (`0.0.0-v2-…` builds, and releases after
 * the 7.x line) says `shell`; earlier lines, and an unknown server, `bash`.
 */
export function shellPermissionName(serverVersion: string | undefined): ShellPermissionName {
	if (!serverVersion) return "bash";
	if (/(^|[-.])v2([-.]|$)/u.test(serverVersion)) return "shell";
	const major = Number(/^(\d+)\./u.exec(serverVersion)?.[1]);
	return Number.isFinite(major) && major >= 8 ? "shell" : "bash";
}

/** Whether a permission request is the shell's, by either line's name for it. */
export const isShellPermission = (permission: string): boolean =>
	permission === "shell" || permission === "bash";

/**
 * Whether a shell command matches one of the mutating conda-CLI patterns
 * above — i.e. the agent is running a conda mutation through the shell rather
 * than the gated MCP tools. Mirrors the `*<fragment>*` glob so the UI can treat
 * such a permission request as per-action-only (no standing "Always allow").
 */
export function matchesMutatingCondaCli(command: string): boolean {
	return condaCliMutationFragments().some((fragment) => command.includes(fragment));
}

/**
 * Session permission rules requiring **per-action user approval** (`ask`)
 * before the agent runs a mutating conda-family command through the shell,
 * under the running server's name for it (`shell`).
 *
 * The MCP conda tools are gated above, but the agent can instead shell out to
 * `conda`/`mamba`/`micromamba` (e.g. to install a local package file the tool
 * refuses). The shell may still be allowed — by the user's config, an earlier
 * "Always allow", or Auto mode — so the CLI path could run a privileged install
 * with no prompt. These rules keep conda mutations on per-action ask whatever
 * the shell's own rule is, closing that substitution gap.
 *
 * Command-string matching is bypassable (wrappers, `sh -c`, aliases); this is
 * the app-side prompt, not a boundary. Pair with the bridge policy (gate 4),
 * isolation (gate 3), and agent-shell PATH/env scrubbing where available.
 */
export function buildCondaCliPermissionRules(shell: ShellPermissionName): PermissionRule[] {
	return condaCliMutationPatterns().map((pattern) => ({
		permission: shell,
		pattern,
		action: "ask" as const,
	}));
}
