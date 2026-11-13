import { describe, expect, it } from "vitest";

import { Traffic } from "./traffic";

const links = (...keys: string[]) => keys.map((key) => ({ key }));

describe("Traffic", () => {
	it("sends one pulse down each link reached and flashes the domain object", () => {
		const traffic = new Traffic({ travelSeconds: 1, flashSeconds: 0.5 });

		traffic.send("acme.a/one", "event", links("l1", "l2"));

		expect(traffic.pulses().map((p) => [p.linkKey, p.kind, p.t])).toEqual([
			["l1", "event", 0],
			["l2", "event", 0],
		]);
		expect(traffic.flashes()).toEqual([{ domainId: "acme.a/one", kind: "event", strength: 1 }]);
		expect(traffic.idle).toBe(false);
	});

	it("moves pulses along and lets them and the flash fade out", () => {
		const traffic = new Traffic({ travelSeconds: 1, flashSeconds: 0.5, lingerSeconds: 0.1 });
		traffic.send("acme.a/one", "state", links("l1"));

		traffic.advance(0.25);
		const [halfway] = traffic.pulses();
		expect(halfway!.t).toBeGreaterThan(0);
		expect(halfway!.t).toBeLessThan(1);
		expect(traffic.flashes()[0]!.strength).toBeCloseTo(0.5);

		traffic.advance(1);
		expect(traffic.pulses()).toEqual([]);
		expect(traffic.flashes()).toEqual([]);
		expect(traffic.idle).toBe(true);
	});

	it("restarts the flash of a domain object that fires again", () => {
		const traffic = new Traffic({ travelSeconds: 1, flashSeconds: 1 });
		traffic.send("acme.a/one", "event", []);
		traffic.advance(0.5);

		traffic.send("acme.a/one", "state", []);

		expect(traffic.flashes()).toEqual([{ domainId: "acme.a/one", kind: "state", strength: 1 }]);
	});

	it("drops the oldest pulses beyond its capacity", () => {
		const traffic = new Traffic({ capacity: 2 });

		traffic.send("acme.a/one", "event", links("old"));
		traffic.send("acme.a/one", "event", links("mid", "new"));

		expect(traffic.pulses().map((p) => p.linkKey)).toEqual(["mid", "new"]);
	});

	it("holds a relayed delivery back until the hop before it arrives", () => {
		const traffic = new Traffic({ travelSeconds: 1, flashSeconds: 0.5 });
		traffic.send("acme.a/one", "event", links("down"));
		traffic.send("mirror:acme.a/one", "event", links("on"), { after: traffic.travelSeconds });

		expect(traffic.pulses().map((p) => p.linkKey)).toEqual(["down"]);
		expect(traffic.flashes().map((f) => f.domainId)).toEqual(["acme.a/one"]);

		traffic.advance(1.1);

		expect(traffic.pulses().map((p) => p.linkKey)).toEqual(["on"]);
		expect(traffic.flashes()).toEqual([
			expect.objectContaining({ domainId: "mirror:acme.a/one", kind: "event" }),
		]);
		expect(traffic.idle).toBe(false);
	});

	it("keeps a flash showing while a later one for the same object waits its turn", () => {
		const traffic = new Traffic({ travelSeconds: 1, flashSeconds: 1 });
		traffic.send("acme.a/one", "event", []);

		traffic.send("acme.a/one", "state", [], { after: 0.5 });

		expect(traffic.flashes()).toEqual([{ domainId: "acme.a/one", kind: "event", strength: 1 }]);
		traffic.advance(0.6);
		expect(traffic.flashes()).toEqual([
			expect.objectContaining({ domainId: "acme.a/one", kind: "state" }),
		]);
	});

	it("lights a link while something travels it, then fades it out", () => {
		const traffic = new Traffic({ travelSeconds: 1, flashSeconds: 0.1, lingerSeconds: 0.5 });
		traffic.send("acme.a/one", "event", links("l1"));
		traffic.send("mirror:acme.a/one", "event", links("l2"), { after: 1 });

		expect(traffic.litLinks()).toEqual(new Map([["l1", 1]]));

		traffic.advance(1.25);
		const lit = traffic.litLinks();
		expect(lit.get("l2")).toBe(1);
		expect(lit.get("l1")).toBeCloseTo(0.5);

		traffic.advance(1.5);
		expect(traffic.litLinks()).toEqual(new Map());
		expect(traffic.idle).toBe(true);
	});

	it("clears everything", () => {
		const traffic = new Traffic();
		traffic.send("acme.a/one", "event", links("l1"));

		traffic.clear();

		expect(traffic.idle).toBe(true);
	});
});
