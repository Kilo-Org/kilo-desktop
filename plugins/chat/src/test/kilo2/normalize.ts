// Recorded kilo2 output made comparable: ids, times and paths that differ on
// every run are replaced by stable placeholders.

const ID = /^(ses|msg|evt|prt|per|frm|inb)_[A-Za-z0-9]+$/;
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

/** Replaces run-specific values (ids by first appearance, times, the project's paths). */
export function normalizeRecording<T>(value: T, project: string): T {
	const ids = new Map<string, string>();
	const counts = new Map<string, number>();
	const walk = (node: unknown, key?: string): unknown => {
		if (typeof node === "string") {
			if (ID.test(node)) {
				let stable = ids.get(node);
				if (!stable) {
					const prefix = node.slice(0, node.indexOf("_"));
					const next = (counts.get(prefix) ?? 0) + 1;
					counts.set(prefix, next);
					stable = `${prefix}_${next}`;
					ids.set(node, stable);
				}
				return stable;
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
