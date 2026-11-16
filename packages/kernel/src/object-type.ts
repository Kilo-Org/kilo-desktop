import type { QualifiedId } from "./ids";

/**
 * A kind of object other plugins point at with an {@link ObjectRef}: a chat,
 * a workspace, a file. Singular, and declared by the plugin that owns the
 * concept. A collection domain object names the object type it resolves;
 * a type with no collection (a file path, a URL) has an owner but no lookup.
 */
export interface ObjectTypeDefinition<TId extends QualifiedId = QualifiedId> {
	readonly id: TId;
	readonly description?: string;
}

export function defineObjectType<TId extends QualifiedId>(definition: {
	readonly id: TId;
	readonly description?: string;
}): ObjectTypeDefinition<TId> {
	return definition;
}

/** A typed reference to one object. Serializable; resolves to `null` once the object is gone. */
export interface ObjectRef<TType extends QualifiedId = QualifiedId> {
	readonly type: TType;
	readonly id: string;
}

export function ref<TId extends QualifiedId>(
	type: ObjectTypeDefinition<TId>,
	id: string,
): ObjectRef<TId> {
	return { type: type.id, id };
}

export function isRef<TId extends QualifiedId>(
	type: ObjectTypeDefinition<TId>,
	value: unknown,
): value is ObjectRef<TId> {
	return (
		typeof value === "object" &&
		value !== null &&
		(value as { type?: unknown }).type === type.id &&
		typeof (value as { id?: unknown }).id === "string"
	);
}
