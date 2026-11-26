import { setTimeout as delay } from "node:timers/promises";

import {
	click,
	expectElementToBeEnabled,
	expectElementToBeHidden,
	expectElementToBeVisible,
	expectElementToHaveAttribute,
	expectElementToHaveText,
	fill,
	getLocator,
	getLocatorByRole,
	getLocatorByTestId,
	pressPageKeyboard,
	reloadPage,
} from "@anaconda/playwright-utils";

import {
	kiloRootSessions,
	kiloServerConnection,
	openNewSession,
	removeWorkSession,
	renameWorkSession,
	sessionListRow,
	shownAgentSessionId,
	type KiloRootSession,
	type KiloServerConnection as KiloConnection,
} from "./agent-session.js";

type KiloSession = KiloRootSession;
type CreatedKiloSession = KiloSession & { prompt: string; workSessionId: string };

const SESSION_POLL_TIMEOUT_MS = 30_000;
const SESSION_POLL_INTERVAL_MS = 500;

export class ChatApprovalSelectorPage {
	private readonly trigger = () =>
		getLocatorByTestId("kilo-approval-selector-trigger", { onlyVisible: true });
	private readonly triggerLabel = () =>
		getLocator('[data-slot="composer-approval-label"]', { onlyVisible: true });
	private readonly menu = () =>
		getLocatorByTestId("kilo-approval-selector-content", { onlyVisible: true });
	private readonly manualItem = () =>
		getLocatorByTestId("kilo-approval-selector-item-manual", { onlyVisible: true });
	private readonly autoItem = () =>
		getLocatorByTestId("kilo-approval-selector-item-auto", { onlyVisible: true });
	private readonly messageInput = () => getLocatorByRole("textbox", { name: "Message input" });
	private readonly sendButton = () => getLocatorByTestId(/^kilo-composer-send(-when-connected)?$/);
	private readonly newChatButton = () => getLocatorByTestId("new-chat");
	private readonly transcript = () =>
		getLocatorByTestId("kilo-agent-pane").getByTestId("kilo-chat-thread");

	private createdSessions: CreatedKiloSession[] = [];

	async openApprovalSelector(): Promise<void> {
		await click(this.trigger());
	}

	async selectAutoApproval(): Promise<void> {
		await this.verifyApprovalMenuOpen();
		await click(this.autoItem());
	}

	async selectManualApproval(): Promise<void> {
		await this.verifyApprovalMenuOpen();
		await click(this.manualItem());
	}

	async closeWithEscape(): Promise<void> {
		await pressPageKeyboard("Escape");
	}

	async reloadApp(): Promise<void> {
		await reloadPage();
		await expectElementToBeEnabled(
			this.newChatButton(),
			"Chat should be ready after the renderer reload",
		);
	}

	async switchToNewChat(): Promise<void> {
		await openNewSession();
	}

	async createPersistedChat(prompt: string): Promise<void> {
		const connection = await this.getConnection();
		const existingIds = new Set((await this.listSessions(connection)).map((session) => session.id));
		await fill(this.messageInput(), prompt);
		await click(this.sendButton());
		const deadline = Date.now() + SESSION_POLL_TIMEOUT_MS;
		while (Date.now() < deadline) {
			const created = (await this.listSessions(connection)).find(
				(session) => !existingIds.has(session.id) && Boolean(session.directory),
			);
			if (created) {
				// Waits for the first send to open the session. The row is found by
				// title; the chat's own title comes from the server later.
				const workSessionId = await shownAgentSessionId();
				await renameWorkSession(workSessionId, prompt);
				this.createdSessions.push({ ...created, prompt, workSessionId });
				return;
			}
			await delay(SESSION_POLL_INTERVAL_MS);
		}
		throw new Error(
			`No persisted chat appeared within ${SESSION_POLL_TIMEOUT_MS}ms after sending.`,
		);
	}

	async switchToPersistedChat(index: number): Promise<void> {
		const session = this.createdSessions[index];
		if (!session) throw new Error(`No persisted test chat exists at index ${index}.`);
		await click(sessionListRow(session.prompt));
		// The session's title (its list row and breadcrumb) is the prompt too.
		await expectElementToBeVisible(this.transcript().getByText(session.prompt, { exact: true }), {
			message: `Persisted chat should display its distinct prompt: "${session.prompt}"`,
		});
	}

	async cleanupCreatedChats(): Promise<void> {
		for (const session of this.createdSessions) await removeWorkSession(session.workSessionId);
		this.createdSessions = [];
	}

	async verifyApprovalLabel(text: string): Promise<void> {
		await expectElementToHaveText(this.triggerLabel(), text, {
			message: `Approval selector should read "${text}"`,
		});
	}

	async verifyApprovalMenuOpen(): Promise<void> {
		await expectElementToBeVisible(this.menu(), "Approval selector menu should be open");
	}

	async verifyApprovalMenuClosed(): Promise<void> {
		await expectElementToBeHidden(this.menu(), "Approval selector menu should be closed");
	}

	async verifyApprovalModeIsSelected(mode: "manual" | "auto"): Promise<void> {
		const item = mode === "manual" ? this.manualItem() : this.autoItem();
		await expectElementToHaveAttribute(item, "aria-checked", "true", {
			message: `Approval menu should show "${mode}" as the selected mode`,
		});
	}

	private getConnection(): Promise<KiloConnection> {
		return kiloServerConnection();
	}

	private listSessions(connection: KiloConnection): Promise<KiloSession[]> {
		return kiloRootSessions(connection);
	}
}
