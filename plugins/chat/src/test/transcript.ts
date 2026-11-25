// Helpers for reading a rendered transcript in browser tests.
import { expect, vi } from "vitest";

/**
 * Clicks disclosures, outermost first and one at a time, until `shown` holds:
 * a settled turn's fold and its activity groups may still collapse themselves
 * once as loaded history settles. DOM clicks: the shell's sidebar rail
 * overlaps the pane.
 */
export async function expandUntil(
	triggers: readonly (() => Element | null)[],
	shown: () => void,
): Promise<void> {
	await vi.waitFor(
		() => {
			const closed = triggers
				.map((trigger) => trigger() as HTMLElement | null)
				.find((element) => element && element.getAttribute("aria-expanded") !== "true");
			closed?.click();
			shown();
		},
		{ timeout: 10_000, interval: 300 },
	);
}

/** A settled turn's "Worked for …" toggle. */
export const turnWork = () => document.querySelector('[data-qa-id="kilo-turn-work-toggle"]');

/** The first button named `name` (its label or its whole text). */
export const button = (name: string | RegExp) => () =>
	[...document.querySelectorAll("button")].find((candidate) => {
		const label = candidate.getAttribute("aria-label") ?? candidate.textContent ?? "";
		return typeof name === "string"
			? label === name || candidate.textContent === name
			: name.test(label) || name.test(candidate.textContent ?? "");
	}) ?? null;

/** Expects `selector` to match an element in the document (not necessarily visible). */
export function expectPresent(selector: string): HTMLElement {
	const element = document.querySelector<HTMLElement>(selector);
	expect(element, selector).not.toBeNull();
	return element!;
}

/**
 * Opens every closed disclosure in the transcript (the turn's fold, activity
 * groups, rows with output) until none is left closed, so every tool row and
 * its details render. Menus (`aria-haspopup`) are left alone.
 */
export async function expandAll(): Promise<void> {
	await vi.waitFor(
		() => {
			const closed = [
				...document.querySelectorAll<HTMLElement>(
					'[data-role="assistant"] [aria-expanded="false"]:not([aria-haspopup])',
				),
			];
			for (const element of closed) element.click();
			expect(closed).toEqual([]);
		},
		{ timeout: 15_000, interval: 400 },
	);
}
