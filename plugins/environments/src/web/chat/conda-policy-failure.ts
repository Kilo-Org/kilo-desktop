import { toolResultText, type ToolCallProps } from "@kilo-desktop/plugin-chat/contracts";

import {
	friendlyEnvironmentsError,
	type FriendlyEnvironmentsError,
} from "../providers/conda/environments-error-message";
import { policyCardContent, type PolicyCardContent } from "./policy-card-content";

/** An error's class name a tool error may be prefixed with on its way to the transcript (`Error: `). */
const ERROR_NAME_PREFIX = /^(?:[A-Za-z]*Error:\s*)+/;

/** A failed conda tool call the chat draws as the policy card, and what the card says. */
export interface CondaPolicyFailure {
	failure: FriendlyEnvironmentsError;
	content: PolicyCardContent;
}

/**
 * A failed conda tool call the person can act on: a package-policy block, a
 * solve failure the policy may explain (`policyNote`), or an Anaconda
 * sign-in refusal. Null for successes and every other failure, which keep
 * the transcript's default row.
 */
export function condaPolicyFailure(
	call: Pick<ToolCallProps, "result" | "isError">,
): CondaPolicyFailure | null {
	if (call.isError !== true) return null;
	const text = toolResultText(call.result).trim().replace(ERROR_NAME_PREFIX, "");
	if (!text) return null;
	const failure = friendlyEnvironmentsError(text, "");
	const content = policyCardContent(failure);
	return content ? { failure, content } : null;
}
