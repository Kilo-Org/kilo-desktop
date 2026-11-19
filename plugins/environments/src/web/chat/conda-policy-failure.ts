import { toolResultText, type ToolCallProps } from "@kilo-desktop/plugin-chat/contracts";

import {
	friendlyEnvironmentsError,
	type FriendlyEnvironmentsError,
} from "../providers/conda/environments-error-message";

/** An error's class name a tool error may be prefixed with on its way to the transcript (`Error: `). */
const ERROR_NAME_PREFIX = /^(?:[A-Za-z]*Error:\s*)+/;

/**
 * A failed conda tool call the person can act on: a package-policy block, a
 * solve failure the policy may explain (`policyNote`), or an Anaconda
 * sign-in refusal. Null for successes and every other failure, which keep
 * the transcript's default row.
 */
export function condaPolicyFailure(
	call: Pick<ToolCallProps, "result" | "isError">,
): FriendlyEnvironmentsError | null {
	if (call.isError !== true) return null;
	const text = toolResultText(call.result).trim().replace(ERROR_NAME_PREFIX, "");
	if (!text) return null;
	const failure = friendlyEnvironmentsError(text, "");
	return showsPolicyCard(failure) ? failure : null;
}

function showsPolicyCard({ code, policy }: FriendlyEnvironmentsError): boolean {
	switch (code) {
		case "POLICY_BLOCKED":
		case "NOT_SIGNED_IN":
		case "CHANNEL_ACCESS_DENIED":
			return true;
		case "SOLVE_FAILED":
			return policy?.policyNote === true;
		default:
			return false;
	}
}
