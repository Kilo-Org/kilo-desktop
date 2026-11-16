import { KernelError, type DomainObjectHandle } from "@kilo-desktop/kernel";
import type { Composer } from "@kilo-desktop/plugin-chat/contracts";

import type { CreateWorkbookInput, SessionWorkbooks, Workbooks } from "../contracts";

export interface StartDeps {
	readonly workbooks: DomainObjectHandle<typeof Workbooks> | null;
	readonly sessions: DomainObjectHandle<typeof SessionWorkbooks> | null;
	readonly composer: DomainObjectHandle<typeof Composer> | null;
}

/**
 * Starts a work session on an existing workbook: a new session and chat in the
 * workbook's workspace, its composer holding the kick-off message (unsent, so
 * the person stays in control), and the workbook recorded as the session's
 * active workbook. Returns the new work session id.
 */
export async function startFromWorkbook(
	deps: StartDeps,
	input: {
		readonly workbookId: string;
		readonly workspaceId: string;
		readonly focus?: string;
		readonly fresh?: boolean;
	},
): Promise<string> {
	const { workbooks, sessions, composer } = ready(deps);
	const text = await workbooks.methods.kickoff({
		workbookId: input.workbookId,
		...(input.focus ? { focus: input.focus } : {}),
		...(input.fresh ? { fresh: true } : {}),
	});
	const { workSessionId } = await composer.methods.startChat({
		text,
		workspaceId: input.workspaceId,
	});
	await sessions.methods.setActive({ workSessionId, workbookId: input.workbookId });
	return workSessionId;
}

/** Creates a workbook from a template, then starts a work session on it. */
export async function startNewWorkbook(
	deps: StartDeps,
	input: CreateWorkbookInput,
): Promise<string> {
	const { workbooks } = ready(deps);
	const workbook = await workbooks.methods.create(input);
	return startFromWorkbook(deps, {
		workbookId: workbook.id,
		workspaceId: input.workspaceId,
		fresh: true,
	});
}

function ready(deps: StartDeps) {
	const { workbooks, sessions, composer } = deps;
	if (!workbooks || !sessions) throw new KernelError("UNAVAILABLE", "Workbooks aren't available.");
	if (!composer) throw new KernelError("UNAVAILABLE", "Chats aren't available in this window.");
	return { workbooks, sessions, composer };
}
