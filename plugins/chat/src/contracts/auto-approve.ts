import { z } from "zod";

import { defineDomainObject, method } from "@kilo-desktop/kernel";

export const approvalModeSchema = z.enum(["manual", "auto"]);
export type ApprovalMode = z.output<typeof approvalModeSchema>;

/** kilo.chat's `kilo.core/tool-approval` contribution id: Auto lets desktop tools proceed. */
export const AUTO_APPROVE_TOOL_APPROVAL_ID = "auto-approve";

/**
 * Whether the agent's permission requests are answered for the person
 * (`auto`, origin's app-wide mode) or left to them (`manual`), answered in
 * main for every window. `holding` lists requests main is answering, and for
 * a moment ones it just resolved, which permission cards keep hidden until
 * they leave the list (kilo.work-sessions' `PERMISSION_AUTO_ANSWER_TIMEOUT_MS`,
 * when the notifier sounds for them too, or a failed reply).
 */
export const AutoApprove = defineDomainObject({
	id: "kilo.chat/auto-approve",
	home: "main",
	description: "Whether the agent's permission requests are answered automatically.",
	state: z.object({
		mode: approvalModeSchema,
		/** Permission request ids main is answering, and for a moment ones it just resolved. */
		holding: z.array(z.string()),
	}),
	methods: {
		/** kilo.chat's own control only: Auto answers the agent's requests for the person. */
		setMode: method(z.object({ mode: approvalModeSchema }), z.undefined()),
	},
});

/** The parts of a permission request that decide whether a machine may answer it. */
export interface AutoReplyCandidate {
	readonly action: string;
	readonly metadata: Readonly<Record<string, unknown>>;
}

const PERSON_ONLY_ACTIONS: ReadonlySet<string> = new Set([
	"sandbox_escalation",
	"browser_sensitive",
]);
const PERSON_ONLY_FLAGS = ["interactive", "sandboxEscalation", "browserSensitive"] as const;

/**
 * A request only a person may answer, so auto-approve leaves it, as Kilo v2's
 * own clients do (`KiloPermission.requiresPerson` and VS Code's
 * `canAutoApprove`): Kilo plugins mark such requests `interactive: true` (a
 * sandbox escalation, a sensitive browser step), and those two actions and
 * their flags count too. Only the literal `true` counts.
 */
export function needsPerson(request: AutoReplyCandidate): boolean {
	return (
		PERSON_ONLY_ACTIONS.has(request.action) ||
		PERSON_ONLY_FLAGS.some((flag) => request.metadata[flag] === true)
	);
}
