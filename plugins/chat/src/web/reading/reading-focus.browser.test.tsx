import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { definePlugin, KernelTelemetrySink, type TelemetryEnvelope } from "@kilo-desktop/kernel";
import { testManifest } from "@kilo-desktop/kernel/testing";
import { Reading, Theme } from "@kilo-desktop/plugin-shell/contracts";
import { readingThemeStyle } from "@kilo-desktop/ui/lib/reading/reading-theme";

import { chatPaneObject } from "../../contracts";
import { agentPane, chatSummary } from "../../test/chat-host";
import { assistantMessage, FakeKiloServer, userMessage } from "../../test/fake-kilo-server";
import { renderChat } from "../../test/render-chat";

afterEach(() => {
	vi.unstubAllGlobals();
});

const reply = (text: string) => ({ type: "text", text, time: { start: 3, end: 4 } });

const ANSWER = [
	"## Plan",
	"First we read the login handler.",
	"Then we fix the redirect after sign-in.",
	"Finally we add a regression test.",
].join("\n\n");

function telemetrySink(envelopes: TelemetryEnvelope[]) {
	return {
		manifest: testManifest("acme.sink", {
			contributes: { extensions: { "kernel/telemetry-sink": [{ id: "sink" }] } },
		}),
		main: definePlugin({
			activate(sdk) {
				sdk.extensions.implement(KernelTelemetrySink, "sink", {
					deliver: (envelope) => void envelopes.push(envelope),
				});
			},
		}),
	};
}

const EARLIER_PROMPT = "Where does login start?";
const EARLIER_ANSWER = "Login starts in the session middleware.";

async function showReply(
	envelopes: TelemetryEnvelope[] = [],
	options: { strictMode?: boolean; earlierTurn?: boolean } = {},
) {
	const server = new FakeKiloServer();
	server.addChat({
		id: "ses_a",
		directory: "/projects/app",
		title: "Fix login",
		messages: [
			...(options.earlierTurn
				? [
						userMessage("ses_a", "msg_0", EARLIER_PROMPT),
						assistantMessage("ses_a", "msg_00", "msg_0", [reply(EARLIER_ANSWER)]),
					]
				: []),
			userMessage("ses_a", "msg_1", "How do we fix login?"),
			assistantMessage("ses_a", "msg_2", "msg_1", [reply(ANSWER)]),
		],
	});
	const host = await renderChat({
		server,
		pane: agentPane({ object: chatPaneObject("ses_a") }),
		chats: [chatSummary("ses_a")],
		plugins: [telemetrySink(envelopes)],
		...(options.strictMode ? { strictMode: true } : {}),
	});
	await expect
		.element(page.getByText("Then we fix the redirect after sign-in.").first())
		.toBeInTheDocument();
	return host;
}

const inFocus = () => page.getByTestId("chat-focus-content");

/** The reply's blocks in order, as Focus moves through them. */
const REPLY_BLOCKS = [
	"Plan",
	"First we read the login handler.",
	"Then we fix the redirect after sign-in.",
	"Finally we add a regression test.",
];

/** Of `blocks`, the one level with the rail: where "Focus from here" enters (the text's middle in view). */
function paragraphAtRail(blocks: readonly string[]): string {
	const rail = page.getByTestId("chat-focus-rail").element().getBoundingClientRect();
	const y = (rail.top + rail.bottom) / 2;
	const distance = (text: string) => {
		const box = page.getByText(text, { exact: true }).first().element().getBoundingClientRect();
		return y < box.top ? box.top - y : y > box.bottom ? y - box.bottom : 0;
	};
	return blocks.reduce((best, text) => (distance(text) < distance(best) ? text : best));
}

describe("Focus in the chat", () => {
	it("enters from the rail at the paragraph level with it and exits on Esc", async () => {
		await showReply();
		const opacity = (text: string) =>
			(inFocus().getByText(text, { exact: true }).element() as HTMLElement).style.opacity;

		await page.getByText("Then we fix the redirect after sign-in.").first().hover();
		const started = paragraphAtRail(REPLY_BLOCKS);
		await page.getByRole("button", { name: "Focus from here" }).click();

		const takeover = page.getByTestId("shell-takeover");
		await expect.element(takeover).toBeVisible();
		await expect.poll(() => opacity(started)).toBe("");
		const index = REPLY_BLOCKS.indexOf(started);
		const [key, neighbour] =
			index < REPLY_BLOCKS.length - 1
				? (["{ArrowDown}", REPLY_BLOCKS[index + 1]!] as const)
				: (["{ArrowUp}", REPLY_BLOCKS[index - 1]!] as const);
		expect(opacity(neighbour)).toBe("0.3");

		await userEvent.keyboard(key);
		await expect.poll(() => opacity(neighbour)).toBe("");

		await userEvent.keyboard("{Escape}");
		await expect.element(page.getByTestId("shell-takeover")).not.toBeInTheDocument();
	});

	it("shows the whole chat, prompts included, starting on the paragraph it was entered from", async () => {
		await showReply([], { earlierTurn: true });
		const opacity = (text: string) =>
			(inFocus().getByText(text, { exact: true }).element() as HTMLElement).style.opacity;

		await page.getByText("Then we fix the redirect after sign-in.").first().hover();
		const started = paragraphAtRail([EARLIER_ANSWER, ...REPLY_BLOCKS]);
		await page.getByRole("button", { name: "Focus from here" }).click();

		await expect.poll(() => opacity(started)).toBe("");
		for (const text of [EARLIER_PROMPT, EARLIER_ANSWER, "How do we fix login?"]) {
			await expect.element(inFocus().getByText(text)).toBeInTheDocument();
		}
		const prompt = inFocus().getByText("How do we fix login?").element();
		expect(prompt.closest('[data-role="user"]')).not.toBeNull();
		expect(prompt.closest("[data-reading-surface]")).toBeNull();

		// ↑ walks back through every block before it, prompts included, to the first prompt.
		const chat = [EARLIER_PROMPT, EARLIER_ANSWER, "How do we fix login?", ...REPLY_BLOCKS];
		for (let index = chat.indexOf(started) - 1; index >= 0; index -= 1) {
			await userEvent.keyboard("{ArrowUp}");
			await expect.poll(() => opacity(chat[index]!)).toBe("");
		}

		await userEvent.keyboard("{Escape}");
		await expect.element(page.getByTestId("shell-takeover")).not.toBeInTheDocument();
	});

	it("enters from the reading control's Focus switch and leaves from the Exit focus pill", async () => {
		await showReply();

		await page.getByTestId("chat-reading-chat-trigger").click();
		await page.getByRole("switch", { name: "Focus" }).click();

		await expect.element(inFocus().getByText("First we read the login handler.")).toBeVisible();
		await page.getByTestId("focus-exit").click();
		await expect.element(page.getByTestId("shell-takeover")).not.toBeInTheDocument();
	});

	it("shows the reader, in the chosen reading theme, when the window renders under StrictMode", async () => {
		const host = await showReply([], { strictMode: true });
		await host.host.renderer.kernelSdk.domainObjects
			.get(Reading)!
			.methods.update({ themeId: "gruvbox" });

		await page.getByTestId("chat-reading-chat-trigger").click();
		await page.getByRole("switch", { name: "Focus" }).click();

		await expect.element(inFocus().getByText("First we read the login handler.")).toBeVisible();
		const { mode } = host.host.renderer.kernelSdk.domainObjects.get(Theme)!.getState();
		const gruvbox = readingThemeStyle("gruvbox", mode).style as Record<string, string>;
		expect(
			(page.getByTestId("focus-reader").element() as HTMLElement).style.getPropertyValue(
				"--background",
			),
		).toBe(gruvbox["--background"]);
		await userEvent.keyboard("{Escape}");
		await expect.element(page.getByTestId("shell-takeover")).not.toBeInTheDocument();
	});

	it("paints the chat in the reading theme outside Focus, and in the app's own when none is chosen", async () => {
		const host = await showReply();
		const thread = () => page.getByTestId("kilo-chat-thread").element() as HTMLElement;
		expect(thread().style.getPropertyValue("--background")).toBe("");

		await host.host.renderer.kernelSdk.domainObjects
			.get(Reading)!
			.methods.update({ themeId: "gruvbox", mode: "light" });

		const gruvbox = readingThemeStyle("gruvbox", "light").style as Record<string, string>;
		await expect
			.poll(() => thread().style.getPropertyValue("--background"))
			.toBe(gruvbox["--background"]);
		expect(thread().dataset.theme).toBe("light");
		const probe = document.createElement("span");
		probe.style.color = gruvbox["--foreground"]!;
		document.body.append(probe);
		const readingForeground = getComputedStyle(probe).color;
		probe.remove();
		const paragraph = page.getByText("First we read the login handler.").first().element();
		expect(getComputedStyle(paragraph).color).toBe(readingForeground);

		await host.host.renderer.kernelSdk.domainObjects.get(Reading)!.methods.reset(undefined);
		await expect.poll(() => thread().style.getPropertyValue("--background")).toBe("");
	});

	it("sets reply text at the reading text size, and leaves the rest of the transcript alone", async () => {
		const host = await showReply();
		const paragraph = () =>
			page.getByText("First we read the login handler.").first().element() as HTMLElement;
		const prompt = () => page.getByText("How do we fix login?").first().element() as HTMLElement;
		await expect.poll(() => getComputedStyle(paragraph()).fontSize).toBe("14px");
		const promptSize = getComputedStyle(prompt()).fontSize;

		await host.host.renderer.kernelSdk.domainObjects
			.get(Reading)!
			.methods.update({ textSizeStep: 2 });

		await expect.poll(() => getComputedStyle(paragraph()).fontSize).toBe("16px");
		expect(getComputedStyle(prompt()).fontSize).toBe(promptSize);
	});

	it("reports entering and leaving Focus without any text", async () => {
		const envelopes: TelemetryEnvelope[] = [];
		await showReply(envelopes);

		await page.getByText("First we read the login handler.").first().hover();
		await page.getByRole("button", { name: "Focus from here" }).click();
		await expect.element(inFocus()).toBeInTheDocument();
		await userEvent.keyboard("{Escape}");

		await expect.element(page.getByTestId("shell-takeover")).not.toBeInTheDocument();
		await expect
			.poll(() => envelopes.map(({ name }) => name).filter((name) => name.startsWith("Focus")))
			.toEqual(["Focus Entered", "Focus Exited"]);
		const entered = envelopes.find(({ name }) => name === "Focus Entered")!.data;
		expect(entered).toMatchObject({ surface: "reply", source: "rail", isFirstTime: true });
		const exited = envelopes.find(({ name }) => name === "Focus Exited")!.data;
		expect(exited).toMatchObject({ surface: "reply", exitReason: "escape" });
		expect(JSON.stringify(envelopes.map(({ data }) => data))).not.toMatch(/login|redirect/u);
	});

	it("reports what the shortcut enters on, as the rail does", async () => {
		const envelopes: TelemetryEnvelope[] = [];
		const host = await showReply(envelopes);
		await expect
			.poll(() => host.host.renderer.contextKeys.get("kilo.chat/focusAvailable"))
			.toBe(true);

		await host.run("toggle-focus");

		await expect.element(inFocus()).toBeInTheDocument();
		await expect
			.poll(() => envelopes.find(({ name }) => name === "Focus Entered")?.data)
			.toMatchObject({ source: "shortcut", blockCount: "2-5", streaming: false });
	});

	it("saves text selected in Focus, marked in the reading theme's inverted colours", async () => {
		const host = await showReply();
		await page.getByText("Finally we add a regression test.").first().hover();
		await page.getByRole("button", { name: "Focus from here" }).click();
		const paragraph = inFocus().getByText("Finally we add a regression test.").element();
		const node = [...paragraph.childNodes].find((child): child is Text => child instanceof Text)!;
		const range = document.createRange();
		range.setStart(node, node.data.indexOf("regression"));
		range.setEnd(node, node.data.indexOf("regression") + "regression test".length);
		getSelection()!.removeAllRanges();
		getSelection()!.addRange(range);
		paragraph.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));

		await page.getByTestId("chat-selection-menu-save").click();

		await expect
			.poll(() => host.workSessions.saved().state.items.map(({ text }) => text))
			.toEqual(["regression test"]);
		await expect
			.element(page.getByTestId("focus-reader").getByRole("status").getByText("Added to Saved"))
			.toBeVisible();
		await expect.element(page.getByTestId("focus-hint")).not.toBeVisible();
	});
});
