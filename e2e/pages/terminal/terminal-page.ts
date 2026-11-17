import {
	click,
	expectElementNotToContainText,
	expectElementToBeVisible,
	expectElementToContainText,
	expectElementToHaveAttribute,
	expectElementToHaveCount,
	getLocatorByTestId,
	pressLocatorKeyboard,
	pressSequentially,
	wait,
} from "@anaconda/playwright-utils";
import { getPage } from "@anaconda/playwright-utils/page-utils";
import type { FrameLocator, Locator } from "@playwright/test";

import { createAndActivateWorkspace } from "../work-sessions/new-work-session-page.js";

const TERMINAL_KIND = "kilo.terminal/terminal";
const TAB_PREFIX = "chat-pane-tab-";

/** Page object for kilo.terminal's panes in a work session. */
export class TerminalPage {
	/** Registers a workspace (test setup) and makes it the one new sessions start in. */
	async createAndActivateWorkspace(folderPath: string, name: string): Promise<void> {
		await createAndActivateWorkspace(folderPath, name);
	}

	/** Starts a terminal-only session from the launcher; returns its terminal's pane id. */
	async startTerminalSession(): Promise<string> {
		const existing = await this.#paneTabIds();
		await click(getLocatorByTestId("new-chat"));
		await expectElementToBeVisible(
			getLocatorByTestId("workbench-launcher"),
			"New session should open the launcher",
		);
		await click(getLocatorByTestId(`launcher-pane-${TERMINAL_KIND}`));
		await expectElementToBeVisible(
			getLocatorByTestId("session-workbench", { onlyVisible: true }),
			"Starting a terminal session should open it",
		);
		return this.#waitForNewTerminalId(existing);
	}

	async currentTerminalId(): Promise<string> {
		const tab = getLocatorByTestId("session-workbench", { onlyVisible: true }).getByRole("tab", {
			name: /^Terminal(?: \d+)?$/,
		});
		await expectElementToBeVisible(tab, "The new session should show its Terminal tab");
		await expectElementToHaveAttribute(tab, "data-qa-id", /^chat-pane-tab-/, {
			message: "The Terminal tab should identify its pane",
		});
		const qaId = await tab.getAttribute("data-qa-id");
		return qaId!.slice(TAB_PREFIX.length);
	}

	async addTerminal(): Promise<string> {
		const existing = await this.#paneTabIds();
		await click(getLocatorByTestId("chat-pane-toolbar-add"));
		await click(getLocatorByTestId(`chat-pane-launch-${TERMINAL_KIND}`));
		return this.#waitForNewTerminalId(existing);
	}

	async run(paneId: string, command: string): Promise<void> {
		await this.activate(paneId);
		const frame = this.frame(paneId);
		const terminal = frame.getByTestId("ghostty-terminal");
		await expectElementToBeVisible(terminal, `Terminal ${paneId} should initialize ghostty-web`);
		const status = frame.getByTestId("terminal-status");
		await status.filter({ hasText: /Running|Error/ }).waitFor({ state: "attached" });
		if ((await status.textContent()) === "Error") {
			throw new Error(
				`Terminal ${paneId} failed to start: ${await frame.getByTestId("terminal-error").textContent()}`,
			);
		}
		await expectElementToHaveAttribute(terminal, "aria-busy", "false", {
			message: `Terminal ${paneId} should accept input after its session snapshot`,
		});
		await this.#waitForPrompt(paneId);
		for (const key of command) {
			const accepted = Number(await terminal.getAttribute("data-accepted-input-count"));
			await pressSequentially(terminal, key);
			await expectElementToHaveAttribute(
				terminal,
				"data-accepted-input-count",
				String(accepted + 1),
				{ message: `Terminal ${paneId} should accept the next input character` },
			);
		}
		await pressLocatorKeyboard(terminal, "Enter");
	}

	async activate(paneId: string): Promise<void> {
		await click(getLocatorByTestId(`${TAB_PREFIX}${paneId}`));
	}

	async exit(paneId: string): Promise<void> {
		await this.run(paneId, "exit");
		await expectElementToHaveCount(getLocatorByTestId(`${TAB_PREFIX}${paneId}`), 0, {
			message: `Terminal ${paneId} should close after its shell exits`,
		});
	}

	/** Closes the pane while its shell is still running, so main must kill the PTY. */
	async close(paneId: string): Promise<void> {
		// Tab actions are only interactive on the active tab (or on hover).
		await this.activate(paneId);
		await click(getLocatorByTestId(`chat-pane-close-tab-${paneId}`));
		await expectElementToHaveCount(getLocatorByTestId(`${TAB_PREFIX}${paneId}`), 0, {
			message: `Terminal ${paneId} should close when its tab is closed`,
		});
	}

	/** Moves keyboard focus to the pane's tab in the host document, out of the terminal frame. */
	async focusPaneTab(paneId: string): Promise<void> {
		await getLocatorByTestId(`${TAB_PREFIX}${paneId}`).focus();
	}

	async focusTerminal(paneId: string): Promise<void> {
		await click(this.frame(paneId).getByTestId("ghostty-terminal"));
	}

	/** The cursor blinks only while focused; `data-focused` mirrors that state. */
	async verifyFocused(paneId: string, focused: boolean): Promise<void> {
		await expectElementToHaveAttribute(
			this.frame(paneId).getByTestId("ghostty-terminal"),
			"data-focused",
			String(focused),
			{ message: `Terminal ${paneId} should ${focused ? "" : "not "}report keyboard focus` },
		);
	}

	frame(paneId: string): FrameLocator {
		return getLocatorByTestId(`chat-pane-${paneId}`).getByTestId("terminal-frame").contentFrame();
	}

	output(paneId: string): Locator {
		return this.frame(paneId).getByTestId("terminal-output");
	}

	async verifyOutputContains(paneId: string, text: string | RegExp): Promise<void> {
		await expectElementToContainText(this.output(paneId), text, {
			message: `Terminal ${paneId} should contain ${text}`,
		});
	}

	async verifyOutputDoesNotContain(paneId: string, text: string): Promise<void> {
		await expectElementNotToContainText(this.output(paneId), text, {
			message: `Terminal ${paneId} should not contain ${text}`,
		});
	}

	async #waitForPrompt(paneId: string): Promise<void> {
		const output = this.output(paneId);
		await expectElementToContainText(output, /[>$%#]/, {
			message: `Terminal ${paneId} should show a shell prompt before receiving input`,
		});
		let previous = await output.textContent();
		for (let attempt = 0; attempt < 10; attempt += 1) {
			await wait(150);
			const next = await output.textContent();
			if (next === previous && /[>$%#]/.test(next ?? "")) return;
			previous = next;
		}
		throw new Error(`Terminal ${paneId} shell prompt did not settle before receiving input`);
	}

	async #paneTabIds(): Promise<string[]> {
		return getPage().evaluate(
			(prefix) =>
				[...document.querySelectorAll(`[data-qa-id^="${prefix}"]`)].flatMap((element) => {
					const qaId = element.getAttribute("data-qa-id");
					return qaId ? [qaId.slice(prefix.length)] : [];
				}),
			TAB_PREFIX,
		);
	}

	async #waitForNewTerminalId(existing: readonly string[]): Promise<string> {
		const created = await getPage().waitForFunction(
			({ known, prefix }) =>
				[...document.querySelectorAll(`[data-qa-id^="${prefix}"]`)]
					.map((element) => ({
						element,
						paneId: element.getAttribute("data-qa-id")?.slice(prefix.length) ?? "",
					}))
					.find(
						({ element, paneId }) =>
							paneId &&
							!known.includes(paneId) &&
							/^Terminal(?: \d+)?$/.test(element.textContent?.trim() ?? ""),
					)?.paneId ?? false,
			{ known: existing, prefix: TAB_PREFIX },
		);
		const id = (await created.jsonValue()) as string;
		await expectElementToBeVisible(
			getLocatorByTestId(`${TAB_PREFIX}${id}`),
			"A new Terminal pane should appear after launch",
		);
		return id;
	}
}
