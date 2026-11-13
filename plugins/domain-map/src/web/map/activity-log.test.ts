import { describe, expect, it } from "vitest";

import { ActivityLog } from "./activity-log";

const domainId = "acme.a/one";

describe("ActivityLog", () => {
	it("records what domain objects did, newest first, with how many declared users they have", () => {
		const log = new ActivityLog({ limit: 10, now: () => 1000 });

		log.add({ kind: "state", domainId }, 3);
		log.add({ kind: "event", domainId, event: "bumped", payload: { count: 2 } }, 0);

		expect(log.entries()).toEqual([
			{
				id: 2,
				at: 1000,
				domainId,
				kind: "event",
				name: "bumped",
				users: 0,
				payload: '{"count":2}',
			},
			{ id: 1, at: 1000, domainId, kind: "state", name: "state", users: 3, payload: "" },
		]);
	});

	it("keeps only the latest entries", () => {
		const log = new ActivityLog({ limit: 2 });
		for (const name of ["a", "b", "c"]) {
			log.add({ kind: "event", domainId, event: name, payload: null }, 0);
		}

		expect(log.entries().map((entry) => entry.name)).toEqual(["c", "b"]);
	});

	it("shortens long payloads and copes with ones that can't be written out", () => {
		const log = new ActivityLog({ payloadLength: 12 });
		const circular: Record<string, unknown> = {};
		circular.self = circular;

		log.add({ kind: "event", domainId, event: "long", payload: "x".repeat(50) }, 0);
		log.add({ kind: "event", domainId, event: "loop", payload: circular }, 0);
		log.add({ kind: "event", domainId, event: "none", payload: undefined }, 0);

		expect(log.entries().map((entry) => entry.payload)).toEqual([
			"",
			"[unprintable]",
			'"xxxxxxxxxx…',
		]);
	});

	it("clears", () => {
		const log = new ActivityLog();
		log.add({ kind: "state", domainId }, 0);

		log.clear();

		expect(log.entries()).toEqual([]);
	});
});
