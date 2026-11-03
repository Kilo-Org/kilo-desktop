import {
	toolPermissionRules,
	toolWireName,
	type ToolPermissionRule,
	type WorkspaceFolderStamp,
} from "../../contracts";

/**
 * Kilo's per-chat sandbox stamp. Kilo resolves a chat's sandbox from this
 * first, then a per-project preference, then the global `sandbox.enabled`
 * config. Desktop has no sandbox setting yet, so without it a user's CLI or
 * VS Code `sandbox.enabled: true` would silently confine every Desktop chat
 * (anaconda/agentic-desktop#730). `version: 0` matches the VS Code extension.
 */
export const SANDBOX_DISABLED_SESSION_METADATA = {
	"kilocode.sandbox": { enabled: false, version: 0 },
} as const;

/** Lets the agent reach a workspace's other folders (the primary is the chat's directory). */
export function buildWorkspacePermissionRules(
	folders: readonly WorkspaceFolderStamp[],
): ToolPermissionRule[] {
	return folders
		.filter((folder) => !folder.isPrimary)
		.flatMap(({ path }) => [
			{ permission: "external_directory", pattern: path, action: "allow" as const },
			{ permission: "external_directory", pattern: `${path}/*`, action: "allow" as const },
		]);
}

export type ToolApprovalOutcome = "proceed" | "ask" | "reject";

export interface ChatPermissionInput {
	readonly workspaceFolders: readonly WorkspaceFolderStamp[];
	readonly tools: readonly {
		readonly key: string;
		readonly metadata: { readonly approval: string };
	}[];
	/** `kilo.agent/tool-approval`'s answer per tool contribution key. */
	readonly approvals: ReadonlyMap<string, ToolApprovalOutcome>;
	/** Tool wire names `kilo.agent/session-config` turned off. */
	readonly disableTools: readonly string[];
	/** Rules `kilo.agent/session-config` added. */
	readonly sessionPermissions?: readonly ToolPermissionRule[];
}

/**
 * The permission rules a chat is created with: the workspace's folders, the
 * rules session config added, then one rule per agent tool that must ask (its
 * `approval`, or an `ask` answer) and one per tool that is denied (a `reject`
 * answer, or turned off). Kilo applies the last matching rule, so a
 * contributed rule never loosens a tool that asks, and denials come last.
 */
export function chatPermissionRules(input: ChatPermissionInput): ToolPermissionRule[] {
	const denied = new Set(input.disableTools);
	for (const tool of input.tools) {
		if (input.approvals.get(tool.key) === "reject") denied.add(toolWireName(tool.key));
	}
	const asking = toolPermissionRules(
		input.tools.map((tool) => ({
			key: tool.key,
			metadata: {
				approval: input.approvals.get(tool.key) === "ask" ? "ask" : tool.metadata.approval,
			},
		})),
	).filter((rule) => !denied.has(rule.permission));
	return [
		...buildWorkspacePermissionRules(input.workspaceFolders),
		...(input.sessionPermissions ?? []),
		...asking,
		...[...denied].map((permission) => ({ permission, pattern: "*", action: "deny" as const })),
	];
}
