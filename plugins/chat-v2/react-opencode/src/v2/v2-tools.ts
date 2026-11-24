/**
 * Kilo v2's tool and permission vocabulary in v1's, so kilo.chat's tool
 * renderers, activity categories, task list, subagent panes and permission
 * renderers (all keyed by v1 names and reading v1 fields) stay as they were.
 *
 * - Names: v2's `shell` is v1's `bash`, `subagent` is `task`, `patch` is
 *   `apply_patch`; the rest (`read`, `edit`, `write`, `glob`, `grep`,
 *   `webfetch`, `websearch`, `todowrite`, `question`, `skill`) and MCP and
 *   Desktop tools keep their names.
 * - Inputs: `skill` names its skill `id` (v1 `name`); `subagent` its `agent`
 *   (v1 `subagent_type`). Paths are `path`, which the renderers already read.
 * - Metadata: file tools report `files[]` with a unified `patch` each (v1 a
 *   `diff` string); a finished shell call reports its output only as content
 *   (v1 also as `metadata.output`) and its exit code as `exit`, as v1 did.
 * - Permission actions use the same names as the tools.
 */

const V1_NAMES: Readonly<Record<string, string>> = {
	shell: "bash",
	subagent: "task",
	patch: "apply_patch",
};

export const toV1ToolName = (name: string): string => V1_NAMES[name] ?? name;

/** A v2 permission action (`shell`, `subagent`, …) by the v1 name renderers key on. */
export const toV1PermissionName = toV1ToolName;

type Record_ = Record<string, unknown>;

export function toV1ToolInput(name: string, input: Record_): Record_ {
	if (name === "skill" && typeof input.id === "string" && input.name === undefined) {
		return { ...input, name: input.id };
	}
	if (name === "subagent" && typeof input.agent === "string" && input.subagent_type === undefined) {
		return { ...input, subagent_type: input.agent };
	}
	return input;
}

const FILE_TOOLS: ReadonlySet<string> = new Set(["edit", "write", "patch"]);

export function toV1ToolMetadata<M extends Record_ | undefined>(
	name: string,
	metadata: M,
	output?: string,
): M {
	if (!metadata) return metadata;
	if (FILE_TOOLS.has(name) && Array.isArray(metadata.files) && metadata.diff === undefined) {
		const patches = metadata.files.flatMap((file) => {
			const patch = (file as { patch?: unknown } | null)?.patch;
			return typeof patch === "string" && patch.length > 0 ? [patch] : [];
		});
		return (patches.length > 0 ? { ...metadata, diff: patches.join("\n") } : metadata) as M;
	}
	if (name === "shell" && output !== undefined && metadata.output === undefined) {
		return { ...metadata, output } as M;
	}
	return metadata;
}
