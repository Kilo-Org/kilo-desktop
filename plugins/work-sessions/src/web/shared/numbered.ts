/** Chrome-style slots: 1–8 address positions, 9 is always the last item. */
export const NUMBERED_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
export type NumberedSlot = (typeof NUMBERED_SLOTS)[number];

export function idAtShortcutSlot(ids: readonly string[], slot: NumberedSlot): string | undefined {
	if (slot === 9) return ids.at(-1);
	return ids[slot - 1];
}

/**
 * The next of `candidates` below `activeId` in `order`, wrapping to the top;
 * undefined when no other candidate exists.
 */
export function nextCandidateId(
	order: readonly string[],
	candidates: readonly string[],
	activeId: string | undefined,
): string | undefined {
	const others = candidates.filter((id) => id !== activeId);
	const activeIndex = activeId === undefined ? -1 : order.indexOf(activeId);
	return others.find((id) => order.indexOf(id) > activeIndex) ?? others[0];
}

/** The id `delta` places from `activeId`, wrapping; from nothing, the first or last. */
export function adjacentId(
	ids: readonly string[],
	activeId: string | undefined,
	delta: 1 | -1,
): string | undefined {
	if (ids.length === 0) return undefined;
	const index = activeId === undefined ? -1 : ids.indexOf(activeId);
	if (index === -1) return delta === 1 ? ids[0] : ids.at(-1);
	return ids[(index + delta + ids.length) % ids.length];
}
