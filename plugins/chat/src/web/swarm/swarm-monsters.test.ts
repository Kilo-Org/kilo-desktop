import { describe, expect, it } from "vitest";

import { MAIN_AGENT_COLOR, WORKER_COLORS } from "./swarm-colors";
import { MONSTERS, monsterOf } from "./swarm-monsters";

describe("monster avatars", () => {
	it("pairs each worker colour with its own monster, in team order", () => {
		expect(MONSTERS).toHaveLength(11);
		expect(new Set(WORKER_COLORS).size).toBe(11);
		expect(WORKER_COLORS.map((color) => monsterOf(color)?.name)).toEqual(
			MONSTERS.map((monster) => monster.name),
		);
		expect(monsterOf(WORKER_COLORS[0]!.toLowerCase())?.name).toBe("Dapper");
	});

	it("gives the main agent no monster", () => {
		expect(monsterOf(MAIN_AGENT_COLOR)).toBeUndefined();
	});
});
