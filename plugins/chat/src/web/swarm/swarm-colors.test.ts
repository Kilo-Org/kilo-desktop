import { describe, expect, it } from "vitest";

import type { ChatSummary } from "@kilo-desktop/plugin-core/contracts";

import { MAIN_AGENT_COLOR, teamColors, teamRootOf, WORKER_COLORS } from "./swarm-colors";

const chat = (id: string, parentId: string | null, createdAt: number) =>
	({ id, parentId, createdAt }) as ChatSummary;

const chats = {
	root: chat("root", null, 1),
	late: chat("late", "root", 5),
	early: chat("early", "root", 2),
	nested: chat("nested", "early", 3),
	stranger: chat("stranger", null, 4),
};

describe("team colors", () => {
	it("gives the main agent its color and workers theirs in the order they started", () => {
		const colors = teamColors("root", chats, [{ chatId: "roster-only", startedAt: 9 }]);
		expect(colors.get("root")).toBe(MAIN_AGENT_COLOR);
		expect(colors.get("main")).toBe(MAIN_AGENT_COLOR);
		expect(colors.get("early")).toBe(WORKER_COLORS[0]);
		expect(colors.get("nested")).toBe(WORKER_COLORS[1]);
		expect(colors.get("late")).toBe(WORKER_COLORS[2]);
		expect(colors.get("roster-only")).toBe(WORKER_COLORS[3]);
		expect(colors.has("stranger")).toBe(false);
	});

	it("orders by start time from the roster alone, as from chats", () => {
		const fromRoster = teamColors("root", {}, [
			{ chatId: "late", startedAt: 5 },
			{ chatId: "early", startedAt: 2 },
			{ chatId: "nested", startedAt: 3 },
		]);
		const fromChats = teamColors("root", chats);
		for (const id of ["early", "nested", "late"])
			expect(fromRoster.get(id)).toBe(fromChats.get(id));
	});

	it("finds the same team from any member, so a worker's pane matches the board", () => {
		expect(teamRootOf("nested", chats)).toBe("root");
		expect(teamColors(teamRootOf("nested", chats), chats).get("nested")).toBe(
			teamColors("root", chats).get("nested"),
		);
	});
});
