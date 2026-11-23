/**
 * The title Kilo v2 gives a fork of a chat titled `title` (checked by
 * `chat-fork.integration.test.ts`); only used to recognize a fork whose request failed after the server made it.
 */
export function forkedTitle(title: string): string {
	const match = /^(.+) \(fork #(\d+)\)$/.exec(title);
	if (match) return `${match[1]} (fork #${Number(match[2]) + 1})`;
	return `${title} (fork #1)`;
}
