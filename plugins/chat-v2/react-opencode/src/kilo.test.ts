import { describe, expect, it, vi } from "vitest";

import {
	commandHints,
	listAgents,
	listCommands,
	listSkills,
	OPEN_CODE_HISTORY_PAGE_SIZE,
	readHistory,
	type KiloClient,
} from "./kilo";

const agent = (id: string) => ({ id, name: id.toUpperCase(), mode: "primary", hidden: false });

/** A client whose plugin inventory is empty for its first `emptyReads` reads. */
function client(emptyReads: number, lists: Record<string, (reads: number) => unknown[]>) {
	let pluginReads = 0;
	const calls: [string, unknown][] = [];
	const list = (name: string) => async (input: unknown) => {
		calls.push([name, input]);
		return { data: lists[name]?.(pluginReads) ?? [] };
	};
	const kilo = {
		plugin: {
			list: async () => ({ data: ++pluginReads <= emptyReads ? [] : [{ id: "opencode.agent" }] }),
		},
		agent: { list: list("agent.list") },
		command: { list: list("command.list") },
		skill: { list: list("skill.list") },
	};
	return { client: kilo as unknown as KiloClient, calls };
}

describe("a location's lists on Kilo v2", () => {
	it("lists a location's agents once its plugins have registered them", async () => {
		vi.useFakeTimers();
		try {
			const { client: kilo, calls } = client(2, {
				"agent.list": (reads) => (reads <= 2 ? [agent("code")] : [agent("code"), agent("plan")]),
			});

			const agents = listAgents(kilo, "/p");
			await vi.runAllTimersAsync();

			expect((await agents).map(({ id }) => id)).toEqual(["code", "plan"]);
			expect(calls).toEqual([["agent.list", { location: { directory: "/p" } }]]);
		} finally {
			vi.useRealTimers();
		}
	});

	it("lists a location's slash commands and skills once its plugins have registered them", async () => {
		vi.useFakeTimers();
		try {
			const { client: kilo } = client(2, {
				"command.list": (reads) => (reads <= 2 ? [] : [{ name: "init", template: "" }]),
				"skill.list": (reads) => (reads <= 2 ? [] : [{ id: "tdd", name: "tdd" }]),
			});

			const commands = listCommands(kilo, "/p");
			const skills = listSkills(kilo, "/p");
			await vi.runAllTimersAsync();

			expect(await commands).toEqual([{ name: "init", template: "" }]);
			expect(await skills).toEqual([{ id: "tdd", name: "tdd" }]);
		} finally {
			vi.useRealTimers();
		}
	});

	it("lists at once when the server has no plugin inventory", async () => {
		const kilo = {
			plugin: {
				list: async () => {
					throw new Error("no inventory");
				},
			},
			agent: { list: async () => ({ data: [agent("code")] }) },
		} as unknown as KiloClient;

		expect((await listAgents(kilo, "/p")).map(({ id }) => id)).toEqual(["code"]);
	});

	it("lists without waiting where no location is named", async () => {
		const { client: kilo, calls } = client(Number.POSITIVE_INFINITY, {
			"agent.list": () => [agent("code")],
		});

		expect(await listAgents(kilo)).toHaveLength(1);
		expect(calls).toEqual([["agent.list", undefined]]);
	});
});

describe("readHistory", () => {
	it("reads every page, oldest first", async () => {
		const messages = Array.from({ length: OPEN_CODE_HISTORY_PAGE_SIZE + 1 }, (_, index) => ({
			id: `msg_${index}`,
		}));
		const inputs: unknown[] = [];
		const kilo = {
			message: {
				list: async (input: { cursor?: string }) => {
					inputs.push(input);
					const start = Number(input.cursor ?? 0);
					const end = start + OPEN_CODE_HISTORY_PAGE_SIZE;
					return {
						data: messages.slice(start, end),
						cursor: { next: end < messages.length ? String(end) : null },
					};
				},
			},
		} as unknown as KiloClient;

		expect(await readHistory(kilo, "ses_1")).toEqual(messages);
		expect(inputs).toEqual([
			{ sessionID: "ses_1", order: "asc", limit: OPEN_CODE_HISTORY_PAGE_SIZE },
			{
				sessionID: "ses_1",
				order: "asc",
				limit: OPEN_CODE_HISTORY_PAGE_SIZE,
				cursor: String(OPEN_CODE_HISTORY_PAGE_SIZE),
			},
		]);
	});
});

describe("commandHints", () => {
	it("takes each placeholder once, in order", () => {
		expect(commandHints("$2 $ARGUMENTS $2 $1")).toEqual(["$2", "$ARGUMENTS", "$1"]);
		expect(commandHints(undefined)).toEqual([]);
	});
});
