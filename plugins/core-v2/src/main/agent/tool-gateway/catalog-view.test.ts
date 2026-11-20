import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
	echoTool,
	FakeToolSource,
	toolContribution,
	type RecordedCall,
} from "../../../test/agent/tool-source";
import {
	createExternalCatalogView,
	createKiloCatalogView,
	type CallerPolicy,
} from "./catalog-view";
import { DeclinedSignIns } from "./declined-sign-ins";
import { KILO_CALLER_CONTEXT_KEY } from "./kilo-caller-context-plugin";
import { SIGN_IN_DECLINED_TOOL_MESSAGE, signInRequiredToolMessage } from "./sign-in-messages";
import { ToolCatalog } from "./tool-catalog";

const signal = new AbortController().signal;

function setup(
	options: {
		signedIn?: boolean;
		chats?: Record<string, { workSessionId: string; workspaceId: string }>;
		declines?: DeclinedSignIns;
	} = {},
) {
	const calls: RecordedCall[] = [];
	const source = new FakeToolSource([
		toolContribution("kilo.environments/envs-list", echoTool(calls), { requiresSignIn: true }),
		toolContribution(
			"kilo.terminal/read",
			echoTool(calls, z.object({ lines: z.number().max(5) })),
			{
				readOnly: true,
				title: "Read terminal",
			},
		),
		toolContribution("kilo.notebook/open", echoTool(calls), { external: false }),
	]);
	const catalog = new ToolCatalog(source);
	let signedIn = options.signedIn ?? true;
	const policy: CallerPolicy = {
		isSignedIn: () => signedIn,
		stampOfChat: (chatId) => options.chats?.[chatId] ?? { workSessionId: null, workspaceId: null },
		...(options.declines ? { declinedSignIns: options.declines } : {}),
	};
	return {
		calls,
		source,
		kilo: createKiloCatalogView(catalog, policy),
		external: createExternalCatalogView(catalog, policy),
		signIn: () => (signedIn = true),
	};
}

function textOf(result: { content: unknown }): unknown {
	const [first] = result.content as { text: string }[];
	return JSON.parse(first!.text);
}

const caller = (sessionId: string, callId = "call-1") => ({
	[KILO_CALLER_CONTEXT_KEY]: { version: 1, sessionId, callId },
});

describe("catalog views", () => {
	it("lists tools with their title and MCP annotations from the contribution", () => {
		const { kilo } = setup();

		expect(kilo.listTools()[1]).toMatchObject({
			name: "terminal_read",
			title: "Read terminal",
			description: "Echo the input.",
			annotations: { title: "Read terminal", readOnlyHint: true, destructiveHint: false },
		});
	});

	it("advertises the Kilo caller envelope to Kilo without opening the tool's own schema", () => {
		const { kilo, external } = setup();

		expect(kilo.listTools()[1]?.inputSchema).toEqual({
			type: "object",
			properties: {
				lines: { type: "number", maximum: 5 },
				[KILO_CALLER_CONTEXT_KEY]: expect.objectContaining({
					required: ["version", "sessionId", "callId"],
				}),
			},
			required: ["lines"],
		});
		expect(Object.keys(external.listTools()[1]?.inputSchema.properties ?? {})).toEqual(["lines"]);
	});

	it("gives a Kilo call its chat, call and the chat's stamp", async () => {
		const { kilo, calls } = setup({
			chats: { ses_chat: { workSessionId: "wses_1", workspaceId: "ws_1" } },
		});

		const result = await kilo.callTool(
			"terminal_read",
			{ lines: 2, ...caller("ses_chat") },
			signal,
		);

		expect(result.isError).toBeUndefined();
		expect(textOf(result)).toEqual({
			input: { lines: 2 },
			caller: {
				chatId: "ses_chat",
				workSessionId: "wses_1",
				workspaceId: "ws_1",
				callId: "call-1",
				external: false,
			},
		});
		expect(calls[0]?.context.signal).toBe(signal);
	});

	it("gives a chat without a stamp no work session", async () => {
		const { kilo } = setup();

		const result = await kilo.callTool("terminal_read", { lines: 1, ...caller("ses_sub") }, signal);

		expect(textOf(result)).toMatchObject({
			caller: { workSessionId: null, workspaceId: null, chatId: "ses_sub" },
		});
	});

	it.each([
		["a wrong version", { version: 2, sessionId: "ses_chat", callId: "c" }],
		["an empty chat id", { version: 1, sessionId: "", callId: "c" }],
		["a missing call id", { version: 1, sessionId: "ses_chat" }],
		["a non-object envelope", "ses_chat"],
	])("drops a caller envelope with %s", async (_label, envelope) => {
		const { kilo } = setup({
			chats: { ses_chat: { workSessionId: "wses_1", workspaceId: "ws_1" } },
		});

		const result = await kilo.callTool(
			"terminal_read",
			{ lines: 1, [KILO_CALLER_CONTEXT_KEY]: envelope },
			signal,
		);

		expect(textOf(result)).toEqual({
			input: { lines: 1 },
			caller: {
				chatId: null,
				workSessionId: null,
				workspaceId: null,
				callId: null,
				external: false,
			},
		});
	});

	it("never passes a forged envelope from an external app", async () => {
		const { external } = setup({
			chats: { ses_chat: { workSessionId: "wses_1", workspaceId: "ws_1" } },
		});

		const result = await external.callTool(
			"terminal_read",
			{ lines: 1, ...caller("ses_chat") },
			signal,
		);

		expect(textOf(result)).toEqual({
			input: { lines: 1 },
			caller: {
				chatId: null,
				workSessionId: null,
				workspaceId: null,
				callId: null,
				external: true,
			},
		});
	});

	it("hides tools not offered to external apps from them, and refuses their calls", async () => {
		const { kilo, external, calls } = setup();

		expect(kilo.listTools().map((tool) => tool.name)).toContain("notebook_open");
		expect(external.listTools().map((tool) => tool.name)).toEqual([
			"environments_envs_list",
			"terminal_read",
		]);
		await expect(external.callTool("notebook_open", {}, signal)).resolves.toEqual({
			isError: true,
			content: [{ type: "text", text: 'Unknown tool "notebook_open".' }],
		});
		expect(calls).toEqual([]);
	});

	it("refuses input that doesn't match the tool's schema before running it", async () => {
		const { kilo, calls } = setup();

		const result = await kilo.callTool("terminal_read", { lines: 50 }, signal);

		expect(result.isError).toBe(true);
		expect((result.content as { text: string }[])[0]?.text).toMatch(
			/^Invalid input for terminal_read: .*lines/s,
		);
		expect(calls).toEqual([]);
	});

	it("refuses a signed-out call to a sign-in tool, with guidance for each audience", async () => {
		const { kilo, external, calls, signIn } = setup({ signedIn: false });

		await expect(kilo.callTool("environments_envs_list", {}, signal)).resolves.toEqual({
			isError: true,
			content: [{ type: "text", text: signInRequiredToolMessage("kilo") }],
		});
		await expect(external.callTool("environments_envs_list", {}, signal)).resolves.toEqual({
			isError: true,
			content: [{ type: "text", text: signInRequiredToolMessage("external") }],
		});
		expect((await kilo.callTool("terminal_read", { lines: 1 }, signal)).isError).toBeUndefined();
		expect(calls).toHaveLength(1);

		signIn();
		expect((await kilo.callTool("environments_envs_list", {}, signal)).isError).toBeUndefined();
	});

	it("withdraws a plugin's sign-in tools while the person goes without them, until they sign in", async () => {
		const declines = new DeclinedSignIns();
		const { kilo, external, calls } = setup({ signedIn: false, declines });
		const changed = vi.fn();
		kilo.subscribe(changed);
		external.subscribe(() => changed());
		const names = (view: typeof kilo) => view.listTools().map((tool) => tool.name);

		declines.decline("kilo.environments");

		expect(changed).toHaveBeenCalledTimes(2);
		expect(names(kilo)).toEqual(["terminal_read", "notebook_open"]);
		expect(names(external)).toEqual(["terminal_read"]);
		await expect(kilo.callTool("environments_envs_list", {}, signal)).resolves.toEqual({
			isError: true,
			content: [{ type: "text", text: SIGN_IN_DECLINED_TOOL_MESSAGE }],
		});
		expect(calls).toEqual([]);

		declines.clear();

		expect(changed).toHaveBeenCalledTimes(4);
		expect(names(kilo)).toEqual(["environments_envs_list", "terminal_read", "notebook_open"]);
	});

	it("keeps listing other plugins' sign-in tools when one plugin's are declined", () => {
		const declines = new DeclinedSignIns();
		const { kilo } = setup({ signedIn: false, declines });

		declines.decline("kilo.notebook");

		expect(kilo.listTools().map((tool) => tool.name)).toContain("environments_envs_list");
	});

	it("reports a tool's failure as a tool error", async () => {
		const { kilo, source } = setup();
		source.set([
			toolContribution("kilo.terminal/open", {
				...echoTool(),
				run: () => {
					throw new Error("No terminal here.");
				},
			}),
			toolContribution("kilo.terminal/close", { ...echoTool(), run: () => Promise.reject("nope") }),
		]);

		await expect(kilo.callTool("terminal_open", {}, signal)).resolves.toEqual({
			isError: true,
			content: [{ type: "text", text: "No terminal here." }],
		});
		await expect(kilo.callTool("terminal_close", {}, signal)).resolves.toMatchObject({
			content: [{ text: "nope" }],
		});
	});

	it("returns a tool's result as JSON text, null when it returns nothing", async () => {
		const { kilo, source } = setup();
		source.set([toolContribution("kilo.terminal/open", { ...echoTool(), run: () => undefined })]);

		await expect(kilo.callTool("terminal_open", {}, signal)).resolves.toEqual({
			content: [{ type: "text", text: "null" }],
		});
	});

	it("re-lists after the catalog changes and tells subscribers", () => {
		const { kilo, source } = setup();
		const changed = vi.fn();
		kilo.subscribe(changed);
		const before = kilo.listTools();
		expect(kilo.listTools()).toBe(before);

		source.set([toolContribution("kilo.terminal/open")]);

		expect(changed).toHaveBeenCalledOnce();
		expect(kilo.listTools().map((tool) => tool.name)).toEqual(["terminal_open"]);
	});
});
