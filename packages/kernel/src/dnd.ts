import type { AnyDomain, ObjectRef } from "./domain";
import type { QualifiedId } from "./ids";

/**
 * Drag and drop between plugins carries typed references to domain objects,
 * never component state. The payload holds every reference as JSON; one
 * marker format per object type lets a drop target decide acceptance during
 * `dragover`, when browsers expose only the formats, not the data.
 */
export const OBJECT_REFS_FORMAT = "application/x-kilo-object-refs+json";
const TYPE_MARKER_PREFIX = "application/x-kilo-ref-type;";

export interface DataTransferLike {
	readonly types: readonly string[];
	setData(format: string, data: string): void;
	getData(format: string): string;
}

type Accepted = readonly (AnyDomain | QualifiedId)[];

const typeIdOf = (accepted: AnyDomain | QualifiedId): string =>
	typeof accepted === "string" ? accepted : accepted.id;

const markerFor = (type: string): string => `${TYPE_MARKER_PREFIX}${type.toLowerCase()}`;

export function writeDraggedRefs(transfer: DataTransferLike, refs: readonly ObjectRef[]): void {
	transfer.setData(OBJECT_REFS_FORMAT, JSON.stringify(refs));
	for (const type of new Set(refs.map((reference) => reference.type))) {
		transfer.setData(markerFor(type), "");
	}
}

export function acceptsDrag(transfer: DataTransferLike, accepts: Accepted): boolean {
	const types = new Set(transfer.types.map((type) => type.toLowerCase()));
	return accepts.some((accepted) => types.has(markerFor(typeIdOf(accepted))));
}

export function readDraggedRefs(transfer: DataTransferLike, accepts: Accepted): ObjectRef[] {
	const raw = transfer.getData(OBJECT_REFS_FORMAT);
	if (!raw) return [];
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return [];
	}
	if (!Array.isArray(parsed)) return [];
	const accepted = new Set(accepts.map(typeIdOf));
	return parsed.filter(
		(candidate): candidate is ObjectRef =>
			typeof candidate === "object" &&
			candidate !== null &&
			typeof candidate.type === "string" &&
			typeof candidate.id === "string" &&
			accepted.has(candidate.type),
	);
}
