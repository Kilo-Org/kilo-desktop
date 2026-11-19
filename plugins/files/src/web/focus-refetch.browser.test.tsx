import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { refetchOnWindowFocus } from "./focus-refetch.js";

const stops: (() => void)[] = [];
afterEach(() => {
	for (const stop of stops.splice(0)) stop();
});

/** A client with one observed query that asks to refetch on every window focus. */
async function observedQuery() {
	const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const queryFn = vi.fn(async () => "value");
	const observer = new QueryObserver(queries, {
		queryKey: ["listed"],
		queryFn,
		refetchOnWindowFocus: "always",
	});
	stops.push(observer.subscribe(() => {}));
	await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1));
	return { queries, queryFn };
}

describe("refetchOnWindowFocus", () => {
	it("refetches the client's queries when the window gains focus, until stopped", async () => {
		const { queries, queryFn } = await observedQuery();
		const stop = refetchOnWindowFocus(queries);

		window.dispatchEvent(new Event("focus"));
		await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2));

		stop();
		const onFocus = vi.spyOn(queries.getQueryCache(), "onFocus");
		window.dispatchEvent(new Event("focus"));
		expect(onFocus).not.toHaveBeenCalled();
		expect(queryFn).toHaveBeenCalledTimes(2);
	});

	it("leaves other clients alone", async () => {
		const mine = await observedQuery();
		const other = await observedQuery();
		stops.push(refetchOnWindowFocus(mine.queries));

		window.dispatchEvent(new Event("focus"));

		await vi.waitFor(() => expect(mine.queryFn).toHaveBeenCalledTimes(2));
		expect(other.queryFn).toHaveBeenCalledTimes(1);
	});
});
