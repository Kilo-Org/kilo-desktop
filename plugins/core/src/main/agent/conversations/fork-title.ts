/**
 * The title Kilo's server gives a fork of a chat titled `title`. Mirrors
 * `getForkedTitle` in kilocode's `packages/opencode/src/session/session.ts`;
 * only used to recognize a fork whose request failed after the server made it.
 */
export function forkedTitle(title: string): string {
	const match = /^(.+) \(fork #(\d+)\)$/.exec(title);
	if (match) return `${match[1]} (fork #${Number(match[2]) + 1})`;
	return `${title} (fork #1)`;
}
