/**
 * User approval before agent notebook tools run code on the user's machine.
 *
 * Notebook kernels execute arbitrary Python with the user's permissions, so
 * without this gate the notebook tools would bypass the `bash` ask rule. Kilo
 * only prompts for a plugin tool when the tool calls `permission.assert`; the
 * plugin's agent transform (`requireNotebookPrompts`) makes `notebooks_execute`
 * default to `"ask"`.
 *
 * Invariants:
 * - One prompt per tool call, however many cells it runs.
 * - "Always allow" is remembered per notebook within one Kilo session; a new
 *   session asks again. "Allow once" covers one call.
 * - Callers ask before any mutation, so a rejection leaves the notebook unchanged.
 *
 * Kilo remembers "Always allow" as a rule saved for the project (every session), and the
 * assert resolves the same for "once" and "always", so the session scope has
 * to live in the resource Kilo saves: see `executionScope`.
 */
import { assertForCall, type PermissionDomain, type ToolCall } from "./kilo-api";

export const EXECUTE_PERMISSION = "notebooks_execute";

/** The pattern Kilo matches and remembers; free of glob characters (`*`, `?`). */
export function executionScope(sessionId: string, notebookId: string): string {
	return `${sessionId}:${notebookId}`;
}

const PROMPT_LABEL = "Run notebook code";
const RUN_DESCRIPTION =
	"The code runs on your computer with your permissions. Only allow code you expect.";
const RESTART_DESCRIPTION =
	"Restarting clears the notebook's variables and starts its kernel again on your computer.";

export type Execution =
	| { readonly kind: "run"; readonly code: string }
	| {
			readonly kind: "execute";
			readonly cellIds: readonly string[];
			/** Each cell's 1-based place in the notebook: what the permission card shows. */
			readonly cellNumbers: readonly number[];
			readonly allCells: boolean;
	  }
	| { readonly kind: "restart" };

function promptFor(execution: Execution) {
	switch (execution.kind) {
		case "run":
			return {
				title: "Run code in this notebook?",
				description: RUN_DESCRIPTION,
				details: { code: execution.code },
			};
		case "execute": {
			const count = execution.cellIds.length;
			return {
				title: execution.allCells
					? "Run all code cells?"
					: `Run ${count} notebook cell${count === 1 ? "" : "s"}?`,
				description: RUN_DESCRIPTION,
				details: {
					cell_ids: [...execution.cellIds],
					cell_numbers: [...execution.cellNumbers],
					all_cells: execution.allCells,
				},
			};
		}
		case "restart":
			return {
				title: "Restart the notebook kernel?",
				description: RESTART_DESCRIPTION,
				details: {},
			};
	}
}

/** Rejects when the user declines; resolves once execution may proceed. */
export async function requireExecutionApproval(
	permission: PermissionDomain,
	call: ToolCall,
	notebookId: string,
	execution: Execution,
): Promise<void> {
	const { title, description, details } = promptFor(execution);
	const scope = executionScope(call.sessionID, notebookId);
	await assertForCall(permission, call, {
		action: EXECUTE_PERMISSION,
		resources: [scope],
		save: [scope],
		metadata: {
			// `toolName`, `title`, and `description` are what the chat permission card displays.
			toolName: PROMPT_LABEL,
			title,
			description,
			notebook_id: notebookId,
			action: execution.kind,
			...details,
		},
	});
}
