import { describe, expect, it } from "vitest";

import { graphEdges, graphLayout, type GraphMember, type GraphPost } from "./swarm-graph";

const member = (id: string): GraphMember => ({ id, name: id, color: "#000", done: false });

const members = [member("main"), member("a"), member("b"), member("c")];

const post = (
	seq: number,
	from: string,
	to: string,
	type: GraphPost["type"] = "INFO",
): GraphPost => ({ id: `p${seq}`, seq, from, to, type, timestamp: seq * 1000 });

const summary = (edges: ReturnType<typeof graphEdges>["edges"]) =>
	edges.map((edge) => [edge.a, edge.b, edge.posts.map((p) => p.seq), edge.blocking]);

describe("graphEdges", () => {
	it("pairs posts by member regardless of direction, in member order", () => {
		const { edges, inWindow } = graphEdges(members, [
			post(1, "b", "main"),
			post(2, "main", "b", "ASK"),
			post(3, "a", "b"),
		]);
		expect(summary(edges)).toEqual([
			["main", "b", [1, 2], false],
			["a", "b", [3], false],
		]);
		expect([...inWindow]).toEqual(["p1", "p2", "p3"]);
	});

	it("counts a post to everyone toward the sender's edge with every other member", () => {
		const { edges } = graphEdges(members, [post(1, "a", "ALL")]);
		expect(summary(edges)).toEqual([
			["main", "a", [1], false],
			["a", "b", [1], false],
			["a", "c", [1], false],
		]);
	});

	it("skips posts from or to non-members and posts to oneself", () => {
		const { edges, inWindow } = graphEdges(members, [
			post(1, "user", "a"),
			post(2, "a", "ses_gone"),
			post(3, "a", "a"),
			post(4, "ALL", "a"),
		]);
		expect(edges).toEqual([]);
		expect(inWindow.size).toBe(0);
	});

	it("marks an edge blocking when it carries a HOLD or a VETO", () => {
		const { edges } = graphEdges(members, [
			post(1, "a", "b", "HOLD"),
			post(2, "c", "main", "VETO"),
			post(3, "main", "a", "RESULT"),
		]);
		expect(summary(edges)).toEqual([
			["main", "a", [3], false],
			["main", "c", [2], true],
			["a", "b", [1], true],
		]);
	});

	it("orders each edge's posts by their board number", () => {
		const { edges } = graphEdges(members, [post(5, "a", "b"), post(2, "b", "a")]);
		expect(edges[0]?.posts.map((p) => p.seq)).toEqual([2, 5]);
	});

	it("keeps every edge but lists only the posts inside the window as in it", () => {
		const { edges, inWindow } = graphEdges(
			members,
			[post(1, "a", "b"), post(2, "a", "c"), post(3, "a", "b"), post(4, "main", "c")],
			{ from: 2000, to: 3000 },
		);
		expect(edges).toHaveLength(3);
		expect([...inWindow].toSorted()).toEqual(["p2", "p3"]);
	});
});

describe("graphLayout", () => {
	it("puts the main agent at the top centre and the others on an arc below", () => {
		const layout = graphLayout(members, 400, 260);
		const main = layout.get("main")!;
		expect(main.x).toBe(200);
		const others = ["a", "b", "c"].map((id) => layout.get(id)!);
		for (const point of others) expect(point.y).toBeGreaterThan(main.y);
		expect(others.map((point) => point.x)).toEqual(
			others.map((point) => point.x).toSorted((x, y) => x - y),
		);
		// Symmetric about the centre: the middle worker sits straight below.
		expect(others[1]!.x).toBeCloseTo(200);
		expect(others[0]!.x + others[2]!.x).toBeCloseTo(400);
		expect(others[0]!.y).toBeCloseTo(others[2]!.y);
		for (const point of others) {
			expect(point.x).toBeGreaterThanOrEqual(0);
			expect(point.x).toBeLessThanOrEqual(400);
			expect(point.y).toBeLessThanOrEqual(260);
		}
	});

	it("is deterministic and places a lone worker straight below", () => {
		const two = [member("main"), member("a")];
		expect(graphLayout(two, 300, 200)).toEqual(graphLayout(two, 300, 200));
		expect(graphLayout(two, 300, 200).get("a")!.x).toBeCloseTo(150);
	});

	it("lays out a team without the main agent on the arc alone", () => {
		const layout = graphLayout([member("a"), member("b")], 300, 200);
		expect(layout.has("main")).toBe(false);
		expect(layout.size).toBe(2);
	});
});
