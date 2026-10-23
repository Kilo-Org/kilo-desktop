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
	getLocatorByText,
	pressPageKeyboard,
	reloadPage,
} from "@anaconda/playwright-utils";
import { getPage } from "@anaconda/playwright-utils/page-utils";

import { openNewChatDraft } from "./new-chat-draft.js";

type KiloConnection = { baseUrl: string; username: string; password: string };
type KiloSession = { id: string; directory?: string; title?: string };
type CreatedKiloSession = KiloSession & { prompt: string };

const SESSION_POLL_TIMEOUT_MS = 30_000;
const SESSION_POLL_INTERVAL_MS = 500;

export class ChatApprovalSelectorPage {
	private readonly trigger = () => getLocatorByTestId("kilo-approval-selector-trigger");
	private readonly triggerLabel = () => getLocator('[data-slot="composer-approval-label"]');
	private readonly menu = () => getLocatorByTestId("kilo-approval-selector-content");
	private readonly manualItem = () => getLocatorByTestId("kilo-approval-selector-item-manual");
	private readonly autoItem = () => getLocatorByTestId("kilo-approval-selector-item-auto");
	private readonly messageInput = () => getLocatorByRole("textbox", { name: "Message input" });
	private readonly sendButton = () => getLocatorByTestId(/^kilo-composer-send(-when-connected)?$/);
	private readonly newChatButton = () => getLocatorByTestId("new-chat");
	private readonly sessionListItem = (sessionId: string) =>
		getLocator(`[data-kilo-session-id="${sessionId}"] [data-slot="aui_session-list-item-trigger"]`);

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

	async closeByClickingOutside(): Promise<void> {
		await click(this.messageInput());
	}

	async reloadApp(): Promise<void> {
		await reloadPage();
		await expectElementToBeEnabled(
			this.newChatButton(),
			"Chat should be ready after the renderer reload",
		);
	}

	async switchToNewChat(): Promise<void> {
		await click(this.newChatButton());
		await openNewChatDraft();
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
				this.createdSessions.push({ ...created, prompt });
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
		await click(this.sessionListItem(session.id));
		await expectElementToBeVisible(getLocatorByText(session.prompt, { exact: true }), {
			message: `Persisted chat should display its distinct prompt: "${session.prompt}"`,
		});
	}

	async cleanupCreatedChats(): Promise<void> {
		const connection = await this.getConnection();
		for (const session of this.createdSessions) {
			if (!session.directory) continue;
			await getPage().evaluate(
				async ({ currentConnection, currentSession }) => {
					const authorization = `Basic ${btoa(`${currentConnection.username}:${currentConnection.password}`)}`;
					const url = new URL(
						`/session/${encodeURIComponent(currentSession.id)}`,
						currentConnection.baseUrl,
					);
					url.searchParams.set("directory", currentSession.directory!);
					const response = await fetch(url, {
						method: "DELETE",
						headers: { Authorization: authorization },
					});
					if (!response.ok) throw new Error(`Session cleanup failed with ${response.status}.`);
				},
				{ currentConnection: connection, currentSession: session },
			);
		}
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

	private async getConnection(): Promise<KiloConnection> {
		return getPage().evaluate(async () => {
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
				featureId: "kilo-server",
				channel: "server.getConnection",
			});
			if (!response.ok) throw new Error(`[${response.error.code}] ${response.error.message}`);
			return response.value as KiloConnection;
		});
	}

	private async listSessions(connection: KiloConnection): Promise<KiloSession[]> {
		return getPage().evaluate(async (currentConnection) => {
			const authorization = `Basic ${btoa(`${currentConnection.username}:${currentConnection.password}`)}`;
			const response = await fetch(
				`${currentConnection.baseUrl}/experimental/session?roots=true&archived=true`,
				{ headers: { Authorization: authorization }, cache: "no-store" },
			);
			if (!response.ok) throw new Error(`Global session list failed with ${response.status}.`);
			return (await response.json()) as KiloSession[];
		}, connection);
	}
}
