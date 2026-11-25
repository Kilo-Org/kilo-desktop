/**
 * Whether a person must decide a permission request: Kilo v2 marks those
 * `metadata.interactive` (a sensitive browser origin, a sandbox escalation; a
 * headless run rejects them), and a sandbox escalation also
 * `metadata.sandboxEscalation`. Auto never answers one, and its card always
 * shows. Main's auto-approve and the window's permission cards both read
 * this, so they agree.
 */
export function needsPerson(metadata: Readonly<Record<string, unknown>>): boolean {
	return metadata["interactive"] === true || metadata["sandboxEscalation"] === true;
}
