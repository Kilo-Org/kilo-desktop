import { z } from "zod";

import { defineDomainObject, method } from "@kilo-desktop/kernel";

export const approvalModeSchema = z.enum(["manual", "auto"]);
export type ApprovalMode = z.output<typeof approvalModeSchema>;

/** How long an auto-approvable request stays hidden before it is shown anyway. */
export const AUTO_APPROVE_REVEAL_MS = 3_000;

/** kilo.chat's `kilo.core/tool-approval` contribution id: Auto lets desktop tools proceed. */
export const AUTO_APPROVE_TOOL_APPROVAL_ID = "auto-approve";

/**
 * Whether the agent's permission requests are answered for the person
 * (`auto`, origin's app-wide mode) or left to them (`manual`), answered in
 * main for every window. `holding` lists requests being answered or checked
 * right now, which permission cards keep hidden until they are revealed
 * (`AUTO_APPROVE_REVEAL_MS`, or a failed reply drops them from the list).
 */
export const AutoApprove = defineDomainObject({
	id: "kilo.chat/auto-approve",
	home: "main",
	description: "Whether the agent's permission requests are answered automatically.",
	state: z.object({
		mode: approvalModeSchema,
		/** Permission request ids being answered or checked right now. */
		holding: z.array(z.string()),
	}),
	methods: {
		/** kilo.chat's own control only: Auto answers the agent's requests for the person. */
		setMode: method(z.object({ mode: approvalModeSchema }), z.undefined()),
	},
});

function hasFlag(metadata: Readonly<Record<string, unknown>>, key: string): boolean {
	return metadata[key] === true;
}

/**
 * Skipped by auto-approve. Sandbox escalation is the person's call, and
 * approving a protected-config edit (Kilo's own config and rules) "once" can
 * persist new allow rules that outlive Auto mode, unlike in VS Code.
 */
export function neverAutoReplied(metadata: Readonly<Record<string, unknown>>): boolean {
	return hasFlag(metadata, "sandboxEscalation") || hasFlag(metadata, "configProtected");
}

/** Prompts a person always sees: the server also ignores machine replies to skill-shell. */
export function needsPerson(metadata: Readonly<Record<string, unknown>>): boolean {
	return neverAutoReplied(metadata) || hasFlag(metadata, "skillShell");
}
