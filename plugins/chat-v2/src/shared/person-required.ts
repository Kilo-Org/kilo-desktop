import { needsPerson as v1NeedsPerson, neverAutoReplied as v1NeverAutoReplied } from "../contracts";

/**
 * kilo.chat's auto-approve rules with Kilo v2's own flag added: v2 marks a
 * permission request a person must decide `metadata.interactive` (a
 * sensitive browser origin, a sandbox escalation; a headless run rejects
 * them), where v1 used `sandboxEscalation`, `configProtected` and
 * `skillShell`. Auto never answers an interactive request, and its card always
 * shows. Main's auto-approve and the window's permission cards both read
 * these, so they agree.
 */
const isInteractive = (metadata: Readonly<Record<string, unknown>>) =>
	metadata["interactive"] === true;

export function neverAutoReplied(metadata: Readonly<Record<string, unknown>>): boolean {
	return v1NeverAutoReplied(metadata) || isInteractive(metadata);
}

export function needsPerson(metadata: Readonly<Record<string, unknown>>): boolean {
	return v1NeedsPerson(metadata) || isInteractive(metadata);
}
