/** A new work session id. Shared so main and every window mint the same shape. */
export function mintSessionId(): string {
	return `wses_${crypto.randomUUID()}`;
}
