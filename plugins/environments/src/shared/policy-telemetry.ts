import { parseEnvironmentsErrorMessage, type EnvironmentsErrorCode } from "../contracts/common";

/** Where a policy or Anaconda sign-in failure was shown. */
export type PolicyTelemetrySurface = "ui" | "agent_tool" | "notebook";

const REPORTED_CODES: ReadonlySet<EnvironmentsErrorCode> = new Set([
	"POLICY_BLOCKED",
	"NOT_SIGNED_IN",
	"CHANNEL_ACCESS_DENIED",
]);

const MAX_POLICY_IDS = 5;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The `environment-policy-blocked` event's data for a failure, or undefined
 * when the failure is not a policy block, an Anaconda sign-in refusal, or a
 * solve failure with a policy note. Counts and policy UUIDs only: package,
 * channel, org and policy names and the platform's reason text never leave
 * the machine.
 */
export function policyBlockedTelemetry(
	error: unknown,
	surface: PolicyTelemetrySurface,
): Record<string, unknown> | undefined {
	const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
	const parsed = message ? parseEnvironmentsErrorMessage(message) : null;
	if (!parsed) return undefined;
	const policyNote = parsed.policy?.policyNote === true;
	if (!REPORTED_CODES.has(parsed.code) && !policyNote) return undefined;
	const blocked = parsed.policy?.blocked ?? [];
	const policyIds = [
		...new Set(
			blocked.flatMap(({ policyId }) => (policyId && UUID.test(policyId) ? [policyId] : [])),
		),
	].slice(0, MAX_POLICY_IDS);
	return {
		surface,
		errorCode: parsed.code,
		blockedCount: blocked.length,
		policyNote,
		policyIds,
	};
}
