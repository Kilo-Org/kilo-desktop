/** Chrome-style slots: 1–8 address positions, 9 is always the last item. */

export const NUMBERED_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
export type NumberedSlot = (typeof NUMBERED_SLOTS)[number];

export function idAtShortcutSlot(ids: readonly string[], slot: NumberedSlot): string | undefined {
	if (slot === 9) return ids.at(-1);
	return ids[slot - 1];
}

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
