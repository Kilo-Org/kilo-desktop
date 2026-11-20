import { describe, expect, it, vi } from "vitest";

import { listAllSessionPages } from "./session-list-pages";

const row = (id: string, updated: number) => ({ id, time: { updated } });

describe("paging Kilo's session list", () => {
	it("walks every page, repeating boundary rows only once", async () => {
		const fetchPage = vi
			.fn()
			.mockResolvedValueOnce([row("a", 30), row("b", 20)])
			.mockResolvedValueOnce([row("b", 20), row("c", 10)])
			.mockResolvedValueOnce([row("d", 5)]);

		const rows = await listAllSessionPages(fetchPage, 2);

		expect(rows.map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
		expect(fetchPage.mock.calls.map(([query]) => query.cursor)).toEqual([undefined, 21, 11]);
	});

	it("moves past a page whose rows all share the boundary time", async () => {
		const fetchPage = vi
			.fn()
			.mockResolvedValueOnce([row("a", 10), row("b", 10)])
			.mockResolvedValueOnce([row("a", 10), row("b", 10)])
			.mockResolvedValueOnce([]);

		const rows = await listAllSessionPages(fetchPage, 2);

		expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
		expect(fetchPage.mock.calls.map(([query]) => query.cursor)).toEqual([undefined, 11, 10]);
	});
});
