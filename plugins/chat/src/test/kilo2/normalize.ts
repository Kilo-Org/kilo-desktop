// Recorded kilo2 output made comparable: ids, times and paths that differ on
// every run are replaced by stable placeholders.

const ID = /^(ses|msg|evt|prt|per|frm|inb)_[A-Za-z0-9_]+$/;
const TIME_KEYS = new Set([
	"created",
	"updated",
	"completed",
	"firstToken",
	"streamed",
	"started",
	"ran",
	"busy",
	"idle",
	"viewed",
	"archived",
]);

/**
 * Replaces run-specific values: ids by first appearance (an id's suffix keeps
 * one number across prefixes, since kilo2 derives some message ids from their
 * event's id), times, and the project's paths.
 */
export function normalizeRecording<T>(value: T, project: string): T {
	const numbers = new Map<string, number>();
	const walk = (node: unknown, key?: string): unknown => {
		if (typeof node === "string") {
			if (ID.test(node)) {
				const at = node.indexOf("_");
				const suffix = node.slice(at + 1);
				let number = numbers.get(suffix);
				if (number === undefined) {
					number = numbers.size + 1;
					numbers.set(suffix, number);
				}
				return `${node.slice(0, at)}_${number}`;
			}
			if (key === "projectID") return "project";
			if (key === "slug") return "slug";
			if (key === "version") return "version";
			return node.split(project).join("/project");
		}
		if (typeof node === "number" && key && TIME_KEYS.has(key)) return 0;
		if (Array.isArray(node)) return node.map((item) => walk(item));
		if (node && typeof node === "object") {
			return Object.fromEntries(
				Object.entries(node as Record<string, unknown>).map(([child, item]) => [
					child,
					walk(item, child),
				]),
			);
		}
		return node;
	};
	return walk(value) as T;
}

/** A v2 event frame's comparable part. */
export interface EventShape {
	readonly type: string;
	readonly data: unknown;
}

/**
 * Events grouped by type, each group in stream order. kilo2 interleaves
 * parts' `ended` events and the title request with the step, and the order
 * across types varies between runs; within a type it doesn't.
 */
export function eventsByType(events: readonly EventShape[]): Record<string, unknown[]> {
	const groups: Record<string, unknown[]> = {};
	for (const event of events) (groups[event.type] ??= []).push(event.data);
	return Object.fromEntries(Object.entries(groups).sort(([a], [b]) => a.localeCompare(b)));
}
