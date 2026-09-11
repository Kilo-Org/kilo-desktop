import {
	click,
	expectElementToContainText,
	expectElementToHaveAttribute,
	expectElementToBeVisible,
	expectElementToHaveCount,
	expectElementNotToContainText,
	fill,
	getLocator,
	getLocatorByRole,
	getLocatorByTestId,
	getLocatorByText,
	pressLocatorKeyboard,
	pressSequentially,
	wait,
} from "@anaconda/playwright-utils";
import { getPage } from "@anaconda/playwright-utils/page-utils";
import type { FrameLocator, Locator } from "@playwright/test";

export class TerminalPage {
	async createAndSelectWorkspace(folderPath: string, name: string): Promise<void> {
		await getPage().evaluate(
			async ({ folderPath, name }) => {
				type InvokeResult =
					| { ok: true; value: unknown }
					| { ok: false; error: { code: string; message: string } };
				type DesktopGlobal = typeof globalThis & {
					desktopApi: {
						invoke(
							channel: "feature:invoke",
							input: { featureId: string; channel: string; args?: unknown },
						): Promise<InvokeResult>;
					};
				};
				const response = await (globalThis as DesktopGlobal).desktopApi.invoke("feature:invoke", {
					featureId: "kilo-ui",
					channel: "create",
					args: { name, folders: [{ path: folderPath, isPrimary: true }] },
				});
				if (!response.ok) throw new Error(`[${response.error.code}] ${response.error.message}`);
			},
			{ folderPath, name },
		);
		await click(getLocator('[data-slot="aui_thread-list-new"]'));
		await click(getLocatorByRole("combobox", { name: "Select workspace" }));
		await click(getLocatorByText(name, { exact: true }));
	}

	async openFirstTerminal(): Promise<string> {
		await fill(getLocatorByRole("textbox", { name: "Message input" }), "Start terminal smoke test");
		await click(getLocatorByRole("button", { name: "Send message" }));
		await expectElementToBeVisible(
			getLocatorByTestId("chat-pane-toolbar"),
			"Pane toolbar should be visible after the chat starts",
		);
		return this.#launchTerminal();
	}

	async addTerminal(): Promise<string> {
		return this.#launchTerminal();
	}

	async run(instanceId: string, command: string): Promise<void> {
		await this.activate(instanceId);
		const frame = this.frame(instanceId);
		const terminal = frame.getByTestId("ghostty-terminal");
		await expectElementToBeVisible(
			terminal,
			`Terminal ${instanceId} should initialize ghostty-web`,
		);
		const status = frame.getByTestId("terminal-status");
		await status.filter({ hasText: /Running|Error/ }).waitFor({ state: "attached" });
		if ((await status.textContent()) === "Error") {
			throw new Error(
				`Terminal ${instanceId} failed to start: ${await frame.getByTestId("terminal-error").textContent()}`,
			);
		}
		await expectElementToHaveAttribute(terminal, "aria-busy", "false", {
			message: `Terminal ${instanceId} should accept input after its session snapshot`,
		});
		await this.#waitForPrompt(instanceId);
		await pressSequentially(terminal, command);
		await pressLocatorKeyboard(terminal, "Enter");
	}

	async activate(instanceId: string): Promise<void> {
		await click(getLocatorByTestId(`chat-pane-tab-${instanceId}`));
	}

	async verifyTabLabel(instanceId: string, label: string): Promise<void> {
		await expectElementToContainText(getLocatorByTestId(`chat-pane-tab-${instanceId}`), label, {
			message: `Terminal ${instanceId} should be labelled ${label}`,
		});
	}

	async exit(instanceId: string): Promise<void> {
		await this.run(instanceId, "exit");
		await expectElementToHaveCount(getLocatorByTestId(`chat-pane-tab-${instanceId}`), 0, {
			message: `Terminal ${instanceId} should close after its shell exits`,
		});
	}

	frame(instanceId: string): FrameLocator {
		return getLocatorByTestId(`chat-pane-${instanceId}`)
			.getByTestId("terminal-frame")
			.contentFrame();
	}

	output(instanceId: string): Locator {
		return this.frame(instanceId).getByTestId("terminal-output");
	}

	async verifyOutputContains(instanceId: string, text: string): Promise<void> {
		await expectElementToContainText(this.output(instanceId), text, {
			message: `Terminal ${instanceId} should contain ${text}`,
		});
	}

	async verifyOutputDoesNotContain(instanceId: string, text: string): Promise<void> {
		await expectElementNotToContainText(this.output(instanceId), text, {
			message: `Terminal ${instanceId} should not contain ${text}`,
		});
	}

	async #waitForPrompt(instanceId: string): Promise<void> {
		const output = this.output(instanceId);
		await expectElementToContainText(output, /[>$%#]/, {
			message: `Terminal ${instanceId} should show a shell prompt before receiving input`,
		});
		let previous = await output.textContent();
		for (let attempt = 0; attempt < 10; attempt += 1) {
			await wait(150);
			const next = await output.textContent();
			if (next === previous && /[>$%#]/.test(next ?? "")) return;
			previous = next;
		}
		throw new Error(`Terminal ${instanceId} shell prompt did not settle before receiving input`);
	}

	async #launchTerminal(): Promise<string> {
		const existing = await this.#paneTabIds();
		await click(getLocatorByTestId("chat-pane-launch-terminal.terminal"));
		return this.#waitForNewTerminalId(existing);
	}

	async #paneTabIds(): Promise<string[]> {
		return getPage().evaluate(() =>
			[...document.querySelectorAll("[data-qa-id^='chat-pane-tab-']")].flatMap((el) => {
				const qaId = el.getAttribute("data-qa-id");
				return qaId ? [qaId.slice("chat-pane-tab-".length)] : [];
			}),
		);
	}

	async #waitForNewTerminalId(existing: readonly string[]): Promise<string> {
		const created = await getPage().waitForFunction((known: readonly string[]) => {
			const prefix = "chat-pane-tab-";
			const id = [...document.querySelectorAll(`[data-qa-id^="${prefix}"]`)]
				.map((element) => ({
					element,
					instanceId: element.getAttribute("data-qa-id")?.slice(prefix.length) ?? "",
				}))
				.find(
					({ element, instanceId }) =>
						instanceId &&
						!known.includes(instanceId) &&
						/^Terminal(?: \d+)?$/.test(element.textContent?.trim() ?? ""),
				)?.instanceId;
			return id ?? false;
		}, existing);
		const id = (await created.jsonValue()) as string;
		await expectElementToBeVisible(
			getLocatorByTestId(`chat-pane-tab-${id}`),
			"A new Terminal pane should appear after launch",
		);
		return id;
	}
}
