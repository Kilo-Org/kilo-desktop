import { realpath } from "node:fs/promises";

import { getPage } from "@anaconda/playwright-utils/page-utils";
import { expect } from "@playwright/test";

type KiloConnection = {
	baseUrl: string;
	username: string;
	password: string;
	version: string;
	globalDirectory: string;
};

type KiloSession = {
	id: string;
	directory?: string;
};

export class KiloCodePage {
	async createWorkspace(folderPath: string, name: string): Promise<void> {
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
	}

	async verifyAuthenticatedServerTransport(): Promise<void> {
		const result = await getPage().evaluate(async () => {
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
			const invoke = async (featureId: string, channel: string, args?: unknown) => {
				const response = await (globalThis as DesktopGlobal).desktopApi.invoke("feature:invoke", {
					featureId,
					channel,
					...(args === undefined ? {} : { args }),
				});
				if (!response.ok) throw new Error(`[${response.error.code}] ${response.error.message}`);
				return response.value;
			};

			const connection = (await invoke("kilo-server", "server.getConnection")) as {
				baseUrl: string;
				username: string;
				password: string;
				version: string;
				globalDirectory: string;
			};
			const authorization = `Basic ${btoa(`${connection.username}:${connection.password}`)}`;
			const healthResponse = await fetch(`${connection.baseUrl}/global/health`, {
				headers: { Authorization: authorization },
			});
			const health = (await healthResponse.json()) as { healthy?: boolean; version?: string };

			const controller = new AbortController();
			const eventResponse = await fetch(`${connection.baseUrl}/global/event`, {
				headers: { Authorization: authorization },
				signal: controller.signal,
			});
			const eventContentType = eventResponse.headers.get("content-type") ?? "";
			controller.abort();
			await eventResponse.body?.cancel().catch(() => undefined);

			return {
				healthOk: healthResponse.ok && health.healthy === true,
				healthVersion: health.version,
				connectionVersion: connection.version,
				globalDirectory: connection.globalDirectory,
				eventOk: eventResponse.ok,
				eventContentType,
			};
		});

		if (!result.healthOk || result.healthVersion !== result.connectionVersion) {
			throw new Error(
				`Expected authenticated Kilo health ${result.connectionVersion}, got ${result.healthVersion ?? "unhealthy"}.`,
			);
		}
		if (!result.globalDirectory) {
			throw new Error("Expected the Kilo connection to expose its global directory.");
		}
		if (!result.eventOk || !result.eventContentType.includes("text/event-stream")) {
			throw new Error(
				`Expected authenticated Kilo SSE, got ${result.eventContentType || "no content type"}.`,
			);
		}
	}

	async verifyWorkspaceFirstSend(workspaceName: string, expectedDirectory: string): Promise<void> {
		const session = await this.createSessionFromFirstSend(workspaceName);
		try {
			const actualDirectory = session.directory ? await realpath(session.directory) : undefined;
			if (actualDirectory !== (await realpath(expectedDirectory))) {
				throw new Error(
					`Expected ${expectedDirectory}, got ${session.directory ?? "no directory"}.`,
				);
			}
		} finally {
			await this.deleteSession(session);
		}
	}

	async verifyUnscopedFirstSends(): Promise<void> {
		const sessions: KiloSession[] = [];
		try {
			sessions.push(await this.createSessionFromFirstSend(null));
			sessions.push(await this.createSessionFromFirstSend(null));
			if (sessions[0]!.directory === sessions[1]!.directory) {
				throw new Error("Expected unique directories for unscoped first sends.");
			}
			for (const { directory } of sessions) {
				const normalized = directory?.replaceAll("\\", "/");
				if (
					!normalized?.includes("/chats/session-") ||
					normalized.includes("/plugins/kilo-ui/chats/")
				) {
					throw new Error(`Expected a persistent unscoped chat directory, got ${directory}.`);
				}
			}
		} finally {
			await Promise.all(sessions.map((session) => this.deleteSession(session)));
		}
	}

	private async createSessionFromFirstSend(workspaceName: string | null): Promise<KiloSession> {
		const page = getPage();
		await page.evaluate(() => {
			globalThis.location.hash = "#/plugins/chat";
		});
		await page.getByTestId("kilo-chat-thread").waitFor({ state: "visible" });
		await page.locator('[data-slot="aui_thread-list-new"]').click();
		await page.getByRole("combobox", { name: "Select workspace" }).click();
		if (workspaceName) {
			await page.getByText(workspaceName, { exact: true }).click();
		} else {
			await page.getByTestId("workspace-unscoped-command").click();
		}

		const connection = await this.getConnection();
		const existingSessionIds = (await this.listSessions(connection)).map((session) => session.id);
		await page.getByRole("textbox", { name: "Message input" }).fill("Kilo lifecycle smoke test");
		await page.getByRole("button", { name: "Send message" }).click();

		let createdSession: KiloSession | undefined;
		await expect
			.poll(
				async () => {
					createdSession = (await this.listSessions(connection)).find(
						(session) => !existingSessionIds.includes(session.id),
					);
					return createdSession?.directory;
				},
				{ timeout: 30_000 },
			)
			.toBeTruthy();
		return createdSession!;
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

	private async deleteSession(session: KiloSession): Promise<void> {
		if (!session.directory) return;
		const connection = await this.getConnection();
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
}
