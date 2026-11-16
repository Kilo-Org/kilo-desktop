import { useSyncExternalStore } from "react";

import type { WorkSessionRenderers } from "../../contracts";

/*
 * How a work session looks wherever it is shown (its glyph, status,
 * decorations and menu) is drawn by the session list; work sessions views
 * hand the same renderers to their contributions. The list registers them
 * here at activation, so views don't import the list. Until it does (or
 * without it), the renderers draw nothing.
 */

const FALLBACK_RENDERERS: WorkSessionRenderers = {
	Glyph: () => null,
	Status: () => null,
	Decorations: () => null,
	Menu: () => null,
};

let current: WorkSessionRenderers = FALLBACK_RENDERERS;
const listeners = new Set<() => void>();

function set(next: WorkSessionRenderers): void {
	current = next;
	for (const listener of listeners) listener();
}

/** Registers the session list's renderers; returns the disposer. */
export function provideWorkSessionRenderers(renderers: WorkSessionRenderers): () => void {
	set(renderers);
	return () => {
		if (current === renderers) set(FALLBACK_RENDERERS);
	};
}

export function useWorkSessionRenderers(): WorkSessionRenderers {
	return useSyncExternalStore(
		(onChange) => {
			listeners.add(onChange);
			return () => listeners.delete(onChange);
		},
		() => current,
		() => current,
	);
}
