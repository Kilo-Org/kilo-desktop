import { KernelError, type DomainObjectHandle } from "@kilo-desktop/kernel";
import type { Composer } from "@kilo-desktop/plugin-chat/contracts";
import type { StartedWorkSession } from "@kilo-desktop/plugin-work-sessions/contracts";

import type { SessionWorkbooks, Workbooks } from "../contracts";

export interface StartDeps {
	readonly workbooks: DomainObjectHandle<typeof Workbooks> | null;
	readonly sessions: DomainObjectHandle<typeof SessionWorkbooks> | null;
	readonly composer: DomainObjectHandle<typeof Composer> | null;
	/** The New Session page's `start()`: a work session where the page says, not yet open. */
	readonly start: () => Promise<StartedWorkSession>;
}

/**
 * Starts a work session on an existing workbook. The kick-off is built first,
 * so a workbook that can't be read creates no session; then the page's
 * session is created, recorded as working on the workbook and opened, and the
 * kick-off goes into its agent pane's composer, unsent, so the person stays in
 * control. Returns the new work session id.
 */
export async function startFromWorkbook(
	deps: StartDeps,
	input: { readonly workbookId: string; readonly focus?: string; readonly fresh?: boolean },
): Promise<string> {
	const { workbooks, sessions, composer } = ready(deps);
	const text = await workbooks.methods.kickoff({
		workbookId: input.workbookId,
		...(input.focus ? { focus: input.focus } : {}),
		...(input.fresh ? { fresh: true } : {}),
	});
	// After the kick-off on purpose: a workbook that can't be read must create no session.
	// react-doctor-disable-next-line react-doctor/server-sequential-independent-await
	const started = await deps.start();
	try {
		await sessions.methods.setActive({
			workSessionId: started.workSessionId,
			workbookId: input.workbookId,
		});
	} catch (error) {
		await started.discard();
		throw error;
	}
	await started.open();
	await composer.methods.insert({ workSessionId: started.workSessionId, text });
	return started.workSessionId;
}

function ready(deps: StartDeps) {
	const { workbooks, sessions, composer } = deps;
	if (!workbooks || !sessions) throw new KernelError("UNAVAILABLE", "Workbooks aren't available.");
	if (!composer) throw new KernelError("UNAVAILABLE", "Chats aren't available in this window.");
	return { workbooks, sessions, composer };
}
