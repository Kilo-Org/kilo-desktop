/**
 * Identifiers. Plugins are dotted `publisher.name`; everything a plugin owns
 * (extension points, domain objects, commands, context keys) is qualified as
 * `<owner>/<local>`. `kernel` is the reserved owner for the kernel's own items.
 */

export const KERNEL_OWNER = "kernel";

/** `publisher.name`, lowercase kebab segments, at least two segments. */
export const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;

/** A local name inside an owner's namespace: `composer-mention`, `signedIn`, `flag:beta`. */
export const LOCAL_NAME_PATTERN = /^[a-zA-Z][\w-]*(?:[.:][\w-]+)*$/;

export type PluginId = string;
export type QualifiedId = `${string}/${string}`;

export function isPluginId(value: string): boolean {
	return PLUGIN_ID_PATTERN.test(value) && value !== KERNEL_OWNER;
}

export function isLocalName(value: string): boolean {
	return LOCAL_NAME_PATTERN.test(value);
}

export function qualify(owner: string, local: string): QualifiedId {
	return `${owner}/${local}`;
}

export interface ParsedQualifiedId {
	readonly owner: string;
	readonly local: string;
}

export function parseQualifiedId(id: string): ParsedQualifiedId | null {
	const slash = id.indexOf("/");
	if (slash <= 0 || slash !== id.lastIndexOf("/")) return null;
	const owner = id.slice(0, slash);
	const local = id.slice(slash + 1);
	if (owner !== KERNEL_OWNER && !PLUGIN_ID_PATTERN.test(owner)) return null;
	if (!LOCAL_NAME_PATTERN.test(local)) return null;
	return { owner, local };
}

export function isQualifiedId(value: string): value is QualifiedId {
	return parseQualifiedId(value) !== null;
}

export function ownerOf(id: QualifiedId): string {
	return id.slice(0, id.indexOf("/"));
}
