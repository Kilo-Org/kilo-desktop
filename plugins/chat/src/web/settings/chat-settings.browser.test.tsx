import { describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";

import { KernelKeybindings } from "@kilo-desktop/kernel";
import { Navigation } from "@kilo-desktop/plugin-shell/contracts";

import { CHAT_COMMANDS } from "../../contracts";
import { renderChat } from "../../test/render-chat";
import { sendWithCtrlEnter } from "../../test/send-key";

type Host = Awaited<ReturnType<typeof renderChat>>;

const overrides = (host: Host) =>
	host.host.main.kernelSdk.domainObjects.get(KernelKeybindings)!.getState().overrides;

const promptText = (host: Host) =>
	JSON.stringify(
		host.server.requestsTo("POST", "/session/ses_new_1/prompt_async").at(-1)?.body ?? null,
	);

describe("Settings → Chat", () => {
	it("stores the send key as the send-message and new-line shortcuts, and back", async () => {
		const host = await renderChat();
		await host.host.renderer.kernelSdk.domainObjects
			.get(Navigation)!
			.methods.openSettings({ section: "chat" });
		await expect.element(page.getByTestId("chat-settings")).toBeVisible();

		await page.getByTestId("chat-send-key").click();
		await page.getByTestId("chat-send-key-ctrlEnter").click();
		await expect
			.poll(() => overrides(host))
			.toEqual({
				[CHAT_COMMANDS.sendMessage]: expect.stringMatching(/^(Ctrl|Meta)\+Enter$/),
				[CHAT_COMMANDS.newLine]: "Enter",
			});

		await page.getByTestId("chat-send-key").click();
		await page.getByTestId("chat-send-key-enter").click();
		await expect.poll(() => overrides(host)).toEqual({});
	});

	it("makes Enter add a new line and Ctrl/Cmd+Enter send", async () => {
		const host = await renderChat();
		await sendWithCtrlEnter(host);

		const input = page.getByTestId("kilo-composer-input");
		await input.click();
		await userEvent.keyboard("first{Enter}second");
		await expect.element(input).toHaveTextContent("firstsecond");
		expect(promptText(host)).toBe("null");

		await userEvent.keyboard("{Control>}{Enter}{/Control}");
		await expect.poll(() => promptText(host)).toContain("first\\nsecond");
	});
});
