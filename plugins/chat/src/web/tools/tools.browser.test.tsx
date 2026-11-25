import type {
	SessionMessageAssistant,
	SessionMessageAssistantTool,
	SessionMessageInfo,
} from "@kilocode/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { z } from "zod";

import type { PluginEntry } from "@kilo-desktop/kernel";
import {
	defineTool,
	SIGN_IN_DECLINED_TOOL_ERROR_CODE,
	SIGN_IN_REQUIRED_TOOL_ERROR_CODE,
	Tool,
	toolWireName,
	type ModelsState,
} from "@kilo-desktop/plugin-core/contracts";

import { chatPaneObject, ToolRenderer, type ToolRendererProps } from "../../contracts";
import { agentPane, chatSummary, SIGNED_IN, SIGNED_OUT, TEST_MODELS } from "../../test/chat-host";
import { FakeKilo2Server } from "../../test/kilo2/fake-kilo2-server";
import {
	assistantMessage,
	idleMessage,
	reasoning,
	session,
	text,
	tool,
	userMessage,
} from "../../test/kilo2/fixtures";
import { button, expandAll, expandUntil, expectPresent, turnWork } from "../../test/transcript";
import { renderChat } from "../../test/render-chat";

afterEach(() => {
	vi.unstubAllGlobals();
});

const QUESTION = "What does login do?";

const signInRequiredToolMessage = () =>
	`${SIGN_IN_REQUIRED_TOOL_ERROR_CODE} The user is not signed in to Kilo, so this tool did not run.`;
const SIGN_IN_DECLINED_TOOL_MESSAGE = `${SIGN_IN_DECLINED_TOOL_ERROR_CODE} The user chose not to sign in.`;

/** A completed tool call that reports `metadata`. */
function toolWith(
	name: string,
	input: Record<string, unknown>,
	output: string,
	metadata: Record<string, unknown>,
	id?: string,
): SessionMessageAssistantTool {
	const call = tool(name, input, output, id ? { id } : {});
	return { ...call, state: { ...call.state, metadata } as SessionMessageAssistantTool["state"] };
}

const failedTool = (name: string, input: Record<string, unknown>, message: string, id?: string) =>
	tool(name, input, { error: { type: "tool", message } }, id ? { id } : {});

/** The question and a finished one-step turn answering it with `content`. */
function chatWith(content: SessionMessageAssistant["content"]): SessionMessageInfo[] {
	return [
		userMessage(QUESTION),
		assistantMessage(content, { finish: "stop", rawFinish: "stop" }),
		idleMessage(),
	];
}

async function showChat(
	messages: SessionMessageInfo[],
	options: Omit<Parameters<typeof renderChat>[0] & object, "server"> = {},
	server = new FakeKilo2Server(),
) {
	server.addChat(session("ses_a", { title: "Chat" }), messages);
	const host = await renderChat({
		server,
		pane: agentPane({ object: chatPaneObject("ses_a") }),
		chats: [chatSummary("ses_a")],
		...options,
	});
	await expect.element(page.getByText(QUESTION).first()).toBeInTheDocument();
	return host;
}

/** A plugin contributing `extensions`, with renderer and main entries. */
function contributor(
	extensions: Record<string, unknown[]>,
	entries: { web?: PluginEntry; main?: PluginEntry },
) {
	return {
		manifest: {
			manifestVersion: 1,
			id: "acme.tools",
			displayName: "Acme tools",
			version: "1.0.0",
			requires: {
				"kilo.chat/tool-renderer": "optional",
				"kilo.core/tool": "optional",
			},
			contributes: { extensions },
		},
		...entries,
	};
}

/** The code agent remembers Acme's model, so a turn sent after sign-in has a model to run with. */
const REMEMBERED_MODEL = {
	...TEST_MODELS,
	preferences: {
		...TEST_MODELS.preferences,
		byAgent: { code: { aiProviderId: "acme", modelId: "fast-1" } },
	},
};

const promptTexts = (server: FakeKilo2Server) =>
	server.promptsTo("ses_a").map((prompt) => prompt.text);

/** A unified diff of `path` replacing `before` lines with `after` ones. */
const fileDiff = (path: string, before: readonly string[], after: readonly string[]) => ({
	file: path,
	patch: [
		`--- a/${path}`,
		`+++ b/${path}`,
		`@@ -1,${String(before.length)} +1,${String(after.length)} @@`,
		...before.map((line) => `-${line}`),
		...after.map((line) => `+${line}`),
	].join("\n"),
	additions: after.length,
	deletions: before.length,
	status: "modified",
});

describe("kilo.chat's tool renderers", () => {
	it("shows a file edit's diff and counts", async () => {
		await showChat(
			chatWith([
				toolWith(
					"edit",
					{ path: "/projects/app/login.ts", oldString: "a\n", newString: "b\nc\n" },
					"Edit applied",
					{ files: [fileDiff("login.ts", ["a"], ["b", "c"])] },
				),
				text("Edited."),
			]),
		);

		await expandUntil([turnWork, button(/login\.ts/)], () =>
			expect(page.getByText("login.ts").first().element()).toBeVisible(),
		);
		await expect.element(page.getByText("+2").first()).toBeInTheDocument();
	});

	it("shows a command and its output", async () => {
		await showChat(
			chatWith([
				toolWith("shell", { command: "pnpm test", description: "Run the tests" }, "12 passed", {
					status: "completed",
					exit: 0,
					output: "12 passed",
				}),
				text("Tests pass."),
			]),
		);

		await expandUntil([turnWork, button(/pnpm test|Run the tests/)], () =>
			expect(page.getByText("12 passed").element()).toBeVisible(),
		);
	});

	it("groups a turn's searches and web lookups", async () => {
		await showChat(
			chatWith([
				tool("grep", { pattern: "login" }, "Found 2 matches"),
				tool("glob", { pattern: "**/*.ts" }, "a.ts\nb.ts"),
				tool("webfetch", { url: "https://example.com/docs" }),
				tool("websearch", { query: "oauth" }),
				tool("skill", { id: "tdd" }),
				text("Found it."),
			]),
		);

		await expandUntil([turnWork], () =>
			expect(page.getByRole("button", { name: /tools used/ }).element()).toBeVisible(),
		);
	});

	it("lists a running turn's tasks over the composer", async () => {
		const host = await showChat([userMessage(QUESTION)]);
		await vi.waitFor(() => expect(host.server.openStreams).toBe(1));
		const todos = [
			{ content: "Write the tests", status: "completed" },
			{ content: "Port the cards", status: "in_progress" },
		];

		const turn = host.server.startTurn("ses_a");
		turn.step().call("todowrite", { todos }).succeed("", { todos });

		await expect.element(page.getByText("Port the cards")).toBeInTheDocument();
		turn.succeed();
		await expect.element(page.getByText("Port the cards")).not.toBeInTheDocument();
	});

	it("shows a delegation to a subagent", async () => {
		await showChat(
			chatWith([
				toolWith(
					"subagent",
					{ agent: "explore", description: "Audit the login flow", prompt: "Audit it" },
					"Looks fine",
					{ sessionID: "ses_child" },
				),
			]),
		);

		await expandUntil([turnWork], () =>
			expect(page.getByText("Audit the login flow").first().element()).toBeInTheDocument(),
		);
	});
});

describe("every built-in renderer, opened up", () => {
	const PATCH = [
		"*** Begin Patch",
		"*** Update File: src/login.ts",
		"@@ -1,2 +1,2 @@",
		" const a = 1;",
		"-const b = 2;",
		"+const b = 3;",
		"*** Add File: src/new.ts",
		"+export const fresh = true;",
		"*** Delete File: src/old.ts",
		"*** End Patch",
	].join("\n");

	const settledTools = (): SessionMessageAssistantTool[] => [
		tool("read", { path: "/projects/app/src/login.ts" }),
		tool("read", { path: "/projects/app/src/auth.ts" }),
		tool("grep", { pattern: "login", include: "*.ts" }, "Found 3 matches\nsrc/login.ts:1"),
		tool("glob", { pattern: "**/*.ts", path: "/projects/app" }, "src/a.ts\nsrc/b.ts"),
		tool("list", { path: "/projects/app/src" }, "a.ts\nb.ts"),
		tool("codebase_search", { query: "where is auth" }, "src/auth.ts"),
		tool("webfetch", { url: "https://example.com/docs", format: "markdown" }, "# Docs"),
		tool("websearch", { query: "oauth pkce" }, "Result: PKCE"),
		tool("skill", { id: "tdd" }, "Loaded"),
		toolWith("shell", { command: "pnpm test", description: "Run tests" }, "12 passed", {
			status: "completed",
			exit: 0,
			output: "12 passed",
		}),
		failedTool("shell", { command: "make" }, "exit 2"),
		toolWith(
			"edit",
			{
				path: "/projects/app/src/login.ts",
				oldString: "const b = 2;\n",
				newString: "const b = 3;\nconst c = 4;\n",
			},
			"Edit applied",
			{
				files: [
					fileDiff(
						"/projects/app/src/login.ts",
						["const b = 2;"],
						["const b = 3;", "const c = 4;"],
					),
				],
			},
		),
		tool("write", {
			path: "/projects/app/src/new.ts",
			content: "export const x = 1;\nexport const y = 2;\n",
		}),
		toolWith("patch", { patchText: PATCH }, "Patch applied", {
			files: [
				fileDiff("src/login.ts", ["const b = 2;"], ["const b = 3;"]),
				{
					...fileDiff("src/new.ts", [], ["export const fresh = true;"]),
					status: "added",
				},
				{ ...fileDiff("src/old.ts", ["gone"], []), status: "deleted" },
			],
		}),
		tool("question", { questions: [{ question: "Which?", options: [] }] }, "Answered"),
		tool("github_list_issues", {}, "[]"),
		toolWith(
			"subagent",
			{ agent: "explore", description: "Audit login", prompt: "Audit it" },
			"ok",
			{ sessionID: "ses_child" },
		),
		failedTool(
			"subagent",
			{ agent: "general", description: "Audit auth", prompt: "Audit it" },
			"Cancelled",
		),
	];

	it("draws a settled turn's work", async () => {
		await showChat(
			chatWith([reasoning("Planning the change"), ...settledTools(), text("All changed.")]),
		);

		await expandAll();

		await expect.element(page.getByText("12 passed").first()).toBeInTheDocument();
		await expect.element(page.getByRole("button", { name: "Edited new.ts" })).toBeInTheDocument();
		await expect.element(page.getByText("Audit login").first()).toBeInTheDocument();
	});

	it("draws a running turn's work as it happens", async () => {
		const host = await showChat([userMessage(QUESTION)]);
		await vi.waitFor(() => expect(host.server.openStreams).toBe(1));

		const turn = host.server.startTurn("ses_a");
		const step = turn.step();
		step.reasoning("Planning the change");
		for (const call of settledTools()) {
			step.call(call.name, call.state.input as Record<string, unknown>);
		}
		turn.retry(2, { type: "APIError", message: "Overloaded" });

		await expect.element(page.getByRole("status").first()).toBeInTheDocument();
		await expandAll();
		await expect.element(page.getByText("Audit auth").first()).toBeInTheDocument();
	});
});

describe("the agent's HTML pages", () => {
	it.each(["desktop_chat_html_render", "desktop_kilo_ui_html_render"])(
		"shows a %s page above the reply, outside the fold",
		async (name) => {
			await showChat(
				chatWith([
					tool(name, { title: "Sales chart", html: "<p>chart</p>" }),
					text("Sales doubled."),
				]),
			);

			await expect.element(page.getByTitle("Sales chart")).toBeInTheDocument();
			expect(expectPresent('iframe[title="Sales chart"]').getAttribute("sandbox")).toBe(
				"allow-scripts",
			);
		},
	);
});

describe("the tool-renderer point", () => {
	function Framed({ Original, ...props }: ToolRendererProps) {
		return (
			<div data-qa-id="acme-framed" data-tool={props.toolName}>
				<Original {...props} />
			</div>
		);
	}

	function Ping({ args }: ToolRendererProps) {
		return <p data-qa-id="acme-ping">Pinged {String((args as { host?: string }).host)}</p>;
	}

	const plugin = contributor(
		{
			"kilo.chat/tool-renderer": [
				{ id: "framed-shell", tools: ["shell"], priority: 10 },
				{ id: "ping", tools: ["acme.tools/ping"], standalone: true, category: "web" },
			],
		},
		{
			web: {
				activate(sdk) {
					sdk.extensions.implement(ToolRenderer, "framed-shell", { component: Framed });
					sdk.extensions.implement(ToolRenderer, "ping", { component: Ping });
				},
			},
		},
	);

	it("lets a plugin draw its own tool, outside the fold when standalone", async () => {
		await showChat(
			chatWith([
				tool(toolWireName("acme.tools/ping"), { host: "example.com" }),
				text("Reachable."),
			]),
			{ plugins: [plugin] },
		);

		await expect.element(page.getByTestId("acme-ping")).toHaveTextContent("Pinged example.com");
	});

	it("hands an override kilo.chat's renderer to wrap", async () => {
		await showChat(
			chatWith([
				toolWith("shell", { command: "make", description: "Build" }, "built", {
					status: "completed",
					exit: 0,
					output: "built",
				}),
				text("Built."),
			]),
			{ plugins: [plugin] },
		);

		await expandUntil([turnWork, button(/^(Ran|Build)/)], () =>
			expect(expectPresent('[data-qa-id="acme-framed"]').textContent).toMatch(/make|Build/),
		);
	});
});

describe("tools that need sign-in", () => {
	const secretTools = contributor(
		{ "kilo.core/tool": [{ id: "secret", title: "Read secrets", requiresSignIn: true }] },
		{
			main: {
				activate(sdk) {
					sdk.extensions.implement(
						Tool,
						"secret",
						defineTool({ description: "Reads secrets", input: z.object({}), run: () => "ok" }),
					);
				},
			},
		},
	);
	const refused = (callID: string) =>
		failedTool(toolWireName("acme.tools/secret"), {}, signInRequiredToolMessage(), callID);

	it("asks a signed-out person to sign in where the call was refused", async () => {
		const host = await showChat(chatWith([refused("call_secret_1")]), {
			identity: SIGNED_OUT,
			plugins: [secretTools],
		});

		await expect.element(page.getByTestId("kilo-tool-signin-prompt")).toBeVisible();
		await page.getByTestId("kilo-tool-signin-prompt-signin").click();

		await vi.waitFor(() => expect(host.signIn).toHaveBeenCalled());
	});

	it("shows the tool's own sign-in prompt", async () => {
		const prompted = contributor(
			{
				"kilo.core/tool": [
					{
						id: "secret",
						title: "Read secrets",
						requiresSignIn: true,
						signInPrompt: {
							title: "Use the vault?",
							body: "Sign in to read secrets.",
							toolsLabel: "the vault",
						},
					},
				],
			},
			{
				main: {
					activate(sdk) {
						sdk.extensions.implement(
							Tool,
							"secret",
							defineTool({ description: "Reads secrets", input: z.object({}), run: () => "ok" }),
						);
					},
				},
			},
		);
		await showChat(chatWith([refused("call_secret_prompt")]), {
			identity: SIGNED_OUT,
			plugins: [prompted],
		});

		const card = page.getByTestId("kilo-tool-signin-prompt");
		await expect.element(card.getByText("Use the vault?")).toBeVisible();
		await expect.element(card.getByText("Sign in to read secrets.")).toBeVisible();
	});

	it("tells the agent to carry on without the tools when the person declines", async () => {
		const host = await showChat(chatWith([refused("call_secret_2")]), {
			identity: SIGNED_OUT,
			plugins: [secretTools],
		});

		await page.getByTestId("kilo-tool-signin-prompt-decline").click();

		await expect.element(page.getByTestId("kilo-tool-signin-declined")).toBeVisible();
		await expect.poll(() => promptTexts(host.server)[0] ?? "").toContain("continue without");
	});

	it("turns the tool's plugin off for the agent in kilo.core when the person declines", async () => {
		const host = await showChat(chatWith([refused("call_secret_scope")]), {
			identity: SIGNED_OUT,
			plugins: [secretTools],
		});

		await page.getByTestId("kilo-tool-signin-prompt-decline").click();

		await vi.waitFor(() =>
			expect(host.agent.calls.declineSignInTools).toHaveBeenCalledWith({ pluginId: "acme.tools" }),
		);
	});

	it("says the tools are off when kilo.core has their plugin declined", async () => {
		await showChat(chatWith([refused("call_secret_elsewhere")]), {
			identity: SIGNED_OUT,
			plugins: [secretTools],
			declinedSignIns: ["acme.tools"],
		});

		await expect.element(page.getByTestId("kilo-tool-signin-declined")).toBeVisible();
	});

	it("says the tools are off for a call refused because the person already declined", async () => {
		await showChat(
			chatWith([
				failedTool(
					toolWireName("acme.tools/secret"),
					{},
					SIGN_IN_DECLINED_TOOL_MESSAGE,
					"call_secret_after_decline",
				),
			]),
			{ identity: SIGNED_OUT, plugins: [secretTools] },
		);

		await expect.element(page.getByTestId("kilo-tool-signin-declined")).toBeVisible();
	});

	it("remembers a call declined before the upgrade from origin", async () => {
		await showChat(chatWith([refused("call_secret_origin")]), {
			identity: SIGNED_OUT,
			plugins: [secretTools],
			localStorage: {
				"kilo-ui.agent-tool-sign-in.declined-calls": JSON.stringify(["call_secret_origin"]),
			},
		});

		await expect.element(page.getByTestId("kilo-tool-signin-declined")).toBeVisible();
	});

	it("offers to continue once the person has signed in elsewhere", async () => {
		const host = await showChat(chatWith([refused("call_secret_3")]), {
			identity: SIGNED_IN,
			models: REMEMBERED_MODEL,
			plugins: [secretTools],
		});

		await expect.element(page.getByTestId("kilo-tool-signin-signed-in")).toBeVisible();
		await page.getByTestId("kilo-tool-signin-continue").click();
		await expect
			.poll(() => promptTexts(host.server)[0] ?? "")
			.toContain("I've signed in. Please continue.");
	});

	it("continues once the person signs in from the card", async () => {
		const host = await showChat(chatWith([refused("call_secret_after_sign_in")]), {
			identity: SIGNED_OUT,
			models: REMEMBERED_MODEL,
			plugins: [secretTools],
		});
		await page.getByTestId("kilo-tool-signin-prompt-signin").click();
		await vi.waitFor(() => expect(host.signIn).toHaveBeenCalled());

		host.setIdentity(SIGNED_IN);

		await expect
			.poll(() => promptTexts(host.server)[0] ?? "")
			.toContain("I've signed in. Please continue.");
	});

	/** kilo.core's models when Kilo's gateway offers only `modelId`, its default. */
	const kiloModels = (modelId: string): ModelsState => ({
		...TEST_MODELS,
		aiProviders: {
			kilo: {
				id: "kilo",
				name: "Kilo Gateway",
				connected: true,
				source: "kilo",
				env: [],
				canDisconnect: false,
			},
		},
		models: {
			[`kilo/${modelId}`]: {
				aiProviderId: "kilo",
				modelId,
				name: modelId,
				variants: [],
				attachments: true,
				reasoning: false,
				free: false,
				byok: false,
			},
		},
		defaults: { kilo: modelId },
		configuredModel: { aiProviderId: "kilo", modelId },
	});

	it("continues after sign-in only once the signed-in account's models are read", async () => {
		const server = new FakeKilo2Server();
		server.addChat(
			session("ses_a", {
				title: "Chat",
				agent: "code",
				model: { providerID: "kilo", id: "kilo-auto/free" },
			}),
			chatWith([refused("call_secret_race")]),
		);
		const host = await renderChat({
			server,
			pane: agentPane({ object: chatPaneObject("ses_a") }),
			chats: [chatSummary("ses_a")],
			identity: SIGNED_OUT,
			models: kiloModels("kilo-auto/free"),
			plugins: [secretTools],
		});
		await page.getByTestId("kilo-tool-signin-prompt-signin").click();
		await vi.waitFor(() => expect(host.signIn).toHaveBeenCalled());

		// kilo.core as sign-in finishes: its models follow the new account before
		// the account's change reaches the window, and are read for it a moment later.
		const models = host.core.models();
		models.setState({ ...models.state, followingAccount: true });
		host.setIdentity(SIGNED_IN);
		// The card shows the signed-in row as soon as the identity reaches it; a
		// turn sent before the models settle would still carry the signed-out one.
		await expect.element(page.getByTestId("kilo-tool-signin-signed-in")).toBeVisible();
		await expect.element(page.getByTestId("kilo-tool-signin-continue")).not.toBeInTheDocument();
		expect(server.promptsTo("ses_a")).toEqual([]);

		models.setState(kiloModels("kilo-auto/balanced"));

		await expect.poll(() => promptTexts(server)[0] ?? "").toContain("I've signed in.");
		expect(server.chat("ses_a")?.model).toMatchObject({
			providerID: "kilo",
			id: "kilo-auto/balanced",
		});
	});

	it("leaves other tools' errors that mention the marker alone", async () => {
		await showChat(
			chatWith([
				failedTool("shell", { command: "grep" }, signInRequiredToolMessage()),
				text("Searched."),
			]),
			{ identity: SIGNED_OUT, plugins: [secretTools] },
		);

		await expect.element(page.getByText("Searched.")).toBeVisible();
		expect(document.querySelector('[data-qa-id="kilo-tool-signin-prompt"]')).toBeNull();
	});
});
