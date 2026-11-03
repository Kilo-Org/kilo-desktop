import { useState, type DragEvent } from "react";

import { acceptsDrag, readDraggedRefs, writeDraggedRefs } from "../dnd";
import type { AnyDomain, ObjectRef } from "../domain";
import type { QualifiedId } from "../ids";

/** Props that make an element drag the given domain object references. */
export function useDragSource(
	refs: readonly ObjectRef[],
	options: { readonly disabled?: boolean } = {},
) {
	return {
		draggable: !options.disabled,
		onDragStart: (event: DragEvent) => {
			if (options.disabled) return;
			writeDraggedRefs(event.dataTransfer, refs);
			event.dataTransfer.effectAllowed = "copyMove";
		},
	} as const;
}

/**
 * Props and hover state for an element that accepts dropped references of the
 * given types. `onOver` follows the pointer while an accepted drag is over the
 * element (where to insert), `onLeave` fires when it leaves or ends here.
 */
export function useDropTarget(options: {
	readonly accepts: readonly (AnyDomain | QualifiedId)[];
	readonly onDrop: (refs: ObjectRef[], event: DragEvent) => void;
	readonly onOver?: (event: DragEvent) => void;
	readonly onLeave?: () => void;
}) {
	const [isOver, setIsOver] = useState(false);
	const accept = (event: DragEvent): boolean => {
		if (!acceptsDrag(event.dataTransfer, options.accepts)) return false;
		event.preventDefault();
		return true;
	};
	const leave = () => {
		setIsOver(false);
		options.onLeave?.();
	};
	return {
		isOver,
		props: {
			onDragEnter: (event: DragEvent) => {
				if (!accept(event)) return;
				setIsOver(true);
				options.onOver?.(event);
			},
			onDragOver: (event: DragEvent) => {
				if (accept(event)) options.onOver?.(event);
			},
			onDragLeave: (event: DragEvent) => {
				// Moving onto a child element is not leaving.
				const next = event.relatedTarget;
				if (next instanceof Node && event.currentTarget.contains(next)) return;
				leave();
			},
			onDrop: (event: DragEvent) => {
				const accepted = accept(event);
				leave();
				if (!accepted) return;
				const refs = readDraggedRefs(event.dataTransfer, options.accepts);
				if (refs.length > 0) options.onDrop(refs, event);
			},
		},
	} as const;
}
