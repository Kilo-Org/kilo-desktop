import { setTimeout as delay } from "node:timers/promises";

import { expect } from "@playwright/test";
import {
	click,
	clickByJS,
	expectElementToBeHidden,
	expectElementToBeVisible,
	expectElementToHaveAttribute,
	expectElementToHaveText,
	fill,
	getLocator,
	getLocatorByRole,
	getLocatorByTestId,
	isElementVisible,
	pressLocatorKeyboard,
} from "@anaconda/playwright-utils";
import { getPage } from "@anaconda/playwright-utils/page-utils";

import {
	kiloServerConnection,
	removeWorkSession,
	renameWorkSession,
	sessionListRow,
	shownAgentSessionId,
} from "./agent-session.js";
import {
	chatModeSelectorData,
	canonicalizeAgentName,
	type ChatModeSession,
	type KiloAgent,
	type KiloConnection,
} from "../../testdata/chat/mode-selector.js";

/**
 * Composer mode (agent) selector — the "Code ▾" control.
 *
 * Owns the trigger and its label, the radio menu, the comparison of the
 * rendered list against the Kilo CLI catalog, and the send-then-read-back check
 * that the created session recorded the selected agent. The catalog and session
 * data are read from the Kilo server with the connection kilo.core's server
 * domain hands out (`kilo.core/server.connect`).
 */
export class ChatModeSelectorPage {
	private readonly trigger = () => getLocatorByTestId(chatModeSelectorData.locators.triggerTestId);
	private readonly triggerLabel = () => getLocator(chatModeSelectorData.locators.triggerLabel);
	private readonly menu = () => getLocatorByTestId(chatModeSelectorData.locators.menuTestId);
	private readonly modeItem = (name: string) =>
		getLocatorByTestId(`${chatModeSelectorData.locators.agentItemTestIdPrefix}${name}`);
	private readonly messageInput = () =>
		getLocatorByRole("textbox", { name: chatModeSelectorData.locators.messageInputName });
	private readonly sendButton = () =>
		getLocatorByTestId(chatModeSelectorData.locators.sendButtonTestId);

	private sessionIdsBeforeSend: readonly string[] = [];
	private lastSentSession: ChatModeSession | undefined;
	private lastWorkSessionId: string | undefined;

	async openModeSelector(): Promise<void> {
		await this.openMenu();
	}

	/**
	 * Select a mode, converging: the composer can re-render shortly after a draft
	 * opens (thread switch, selection hydration), which remounts the dropdown and
	 * drops an open menu mid-click. Reopen and retry until the click lands,
	 * mirroring the `openNewChatDraft` convergence idiom.
	 *
	 * The item is clicked via `clickByJS` (a DOM click on the element) because the
	 * popup's entrance animation can keep restarting on a busy composer, so
	 * Playwright's coordinate-based click never passes its stability gate — and a
	 * forced coordinate click can land on a neighbouring item as the box moves.
	 * The radio item selects on `click`, so a DOM click is deterministic.
	 */
	async selectMode(name: string): Promise<void> {
		await expect(async () => {
			if (!(await isElementVisible(this.menu()))) {
				await this.openMenu();
			}
			await clickByJS(this.modeItem(name));
			await expectElementToBeHidden(
				this.menu(),
				"Mode selector menu should close after selecting a mode",
			);
		}).toPass({ timeout: chatModeSelectorData.polling.selectionConvergeTimeoutMs });
	}

	async closeWithEscape(): Promise<void> {
		await pressLocatorKeyboard(this.menu(), "Escape");
	}

	async highlightNextMode(): Promise<void> {
		await pressLocatorKeyboard(this.menu(), "ArrowDown");
	}

	async closeByClickingOutside(): Promise<void> {
		await click(this.messageInput());
	}

	async sendPrompt(text: string): Promise<void> {
		const connection = await this.getConnection();
		this.sessionIdsBeforeSend = (await this.listSessions(connection)).map((session) => session.id);
		await fill(this.messageInput(), text);
		await click(this.sendButton());
	}

	async verifyTriggerLabel(text: string): Promise<void> {
		await expectElementToHaveText(this.triggerLabel(), text, {
			message: `Mode selector should read "${text}"`,
		});
	}

	async verifyMenuOpen(): Promise<void> {
		await expectElementToBeVisible(this.menu(), "Mode selector menu should be open");
	}

	async verifyMenuClosed(): Promise<void> {
		await expectElementToBeHidden(this.menu(), "Mode selector menu should be closed");
	}

	async verifyBuiltInModesInOrder(): Promise<void> {
		const rendered = await this.renderedModeIds();
		const builtInModes = chatModeSelectorData.builtInModes;
		const prefix = rendered.slice(0, builtInModes.length);
		await expect(prefix, "Built-in modes should be rendered first in the expected order").toEqual([
			...builtInModes,
		]);
		for (const name of builtInModes) {
			await expectElementToBeVisible(
				this.modeItem(name),
				`Mode menu should list the built-in "${name}" mode`,
			);
		}
	}

	async verifyMenuMatchesCliCatalog(): Promise<void> {
		const cliAgents = [...new Set(await this.fetchCliAgentNames())].sort();
		await expect
			.poll(async () => [...new Set(await this.renderedModeIds())].sort(), {
				message: "Mode menu should match the Kilo CLI catalog",
			})
			.toEqual(cliAgents);
	}

	async verifyModeIsSelected(name: string): Promise<void> {
		await expectElementToHaveAttribute(this.modeItem(name), "aria-checked", "true", {
			message: `Mode menu should show "${name}" in the checked state`,
		});
	}

	async readModeEntries(): Promise<Array<{ id: string; label: string }>> {
		return getPage().evaluate(
			(prefix) =>
				[...document.querySelectorAll(`[data-qa-id^="${prefix}"]`)].map((element) => ({
					id: (element.getAttribute("data-qa-id") ?? "").slice(prefix.length),
					label: element.textContent?.trim() ?? "",
				})),
			chatModeSelectorData.locators.agentItemTestIdPrefix,
		);
	}

	async verifySentSessionAgent(expectedAgent: string): Promise<void> {
		const connection = await this.getConnection();
		const created = await this.awaitCreatedSession(connection);
		this.lastSentSession = created;
		this.lastWorkSessionId = await shownAgentSessionId();
		await renameWorkSession(this.lastWorkSessionId, created.id);
		await expect(created.agent, "Created session should record the selected mode").toBe(
			expectedAgent,
		);
	}

	async switchToSentSession(): Promise<void> {
		await expect(
			this.lastSentSession,
			"A sent session must be verified before switching back to it",
		).toBeDefined();
		await click(sessionListRow(this.lastSentSession!.id));
	}

	async cleanupSentSession(): Promise<void> {
		if (this.lastWorkSessionId) await removeWorkSession(this.lastWorkSessionId);
		this.lastSentSession = undefined;
		this.lastWorkSessionId = undefined;
	}

	private async openMenu(): Promise<void> {
		await this.waitForToolbarSettled();
		await click(this.trigger());
	}

	private async waitForToolbarSettled(): Promise<void> {
		await getPage().waitForFunction(
			(triggerIds) => {
				return triggerIds.every((id) => {
					const trigger = document.querySelector(`[data-qa-id="${id}"]`);
					return trigger !== null && !trigger.hasAttribute("aria-busy");
				});
			},
			[...chatModeSelectorData.locators.busyCatalogTriggerIds],
		);
	}

	private async renderedModeIds(): Promise<string[]> {
		return (await this.readModeEntries()).map((entry) => entry.id);
	}

	private async fetchCliAgentNames(): Promise<string[]> {
		const kilo = await this.getConnection();
		const result = await getPage().evaluate(async (connection) => {
			const authorization = `Basic ${btoa(`${connection.username}:${connection.password}`)}`;
			const agentResponse = await fetch(`${connection.baseUrl}/agent`, {
				headers: {
					Authorization: authorization,
					"x-kilo-directory": encodeURIComponent(connection.globalDirectory),
				},
				cache: "no-store",
			});
			if (!agentResponse.ok) {
				return {
					ok: false as const,
					error: `Kilo agent catalog failed with ${agentResponse.status}.`,
				};
			}
			return { ok: true as const, agents: (await agentResponse.json()) as KiloAgent[] };
		}, kilo);

		await expect(result.ok, result.ok ? "" : result.error).toBe(true);
		if (!result.ok) return [];
		const selectable = result.agents.filter(
			(agent) =>
				!agent.hidden && !agent.deprecated && (agent.mode === "primary" || agent.mode === "all"),
		);
		return [...new Set(selectable.map((agent) => canonicalizeAgentName(agent.name)))];
	}

	private async getConnection(): Promise<KiloConnection> {
		return (await kiloServerConnection()) as KiloConnection;
	}

	private async listSessions(connection: KiloConnection): Promise<ChatModeSession[]> {
		const result = await getPage().evaluate(async (currentConnection) => {
			const authorization = `Basic ${btoa(`${currentConnection.username}:${currentConnection.password}`)}`;
			const response = await fetch(
				`${currentConnection.baseUrl}/experimental/session?roots=true&archived=true`,
				{ headers: { Authorization: authorization }, cache: "no-store" },
			);
			return response.ok
				? { ok: true as const, sessions: (await response.json()) as ChatModeSession[] }
				: { ok: false as const, error: `Global session list failed with ${response.status}.` };
		}, connection);
		await expect(result.ok, result.ok ? "" : result.error).toBe(true);
		return result.ok ? result.sessions : [];
	}

	private async awaitCreatedSession(connection: KiloConnection): Promise<ChatModeSession> {
		const knownIds = [...this.sessionIdsBeforeSend];
		const deadline = Date.now() + chatModeSelectorData.polling.sessionTimeoutMs;
		let created: ChatModeSession | undefined;
		while (Date.now() < deadline && !created) {
			created = (await this.listSessions(connection)).find(
				(entry) => !knownIds.includes(entry.id) && Boolean(entry.agent),
			);
			if (!created) await delay(chatModeSelectorData.polling.sessionIntervalMs);
		}
		await expect(
			created,
			`A new session with a recorded agent should appear within ${chatModeSelectorData.polling.sessionTimeoutMs}ms`,
		).toBeDefined();
		return created!;
	}
}
