import { getPage } from "@anaconda/playwright-utils/page-utils";

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
					featureId: "workspaces",
					channel: "create",
					args: { name, folders: [{ path: folderPath, isPrimary: true }] },
				});
				if (!response.ok) throw new Error(`[${response.error.code}] ${response.error.message}`);
			},
			{ folderPath, name },
		);
	}

	async verifyAuthenticatedServerTransport(workspaceName: string): Promise<void> {
		const result = await getPage().evaluate(async (expectedWorkspaceName) => {
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

			const workspaces = (await invoke("workspaces", "list")) as Array<{
				id: string;
				name: string;
				folders: Array<{ path: string; isPrimary: boolean }>;
			}>;
			const workspace = workspaces.find((candidate) => candidate.name === expectedWorkspaceName);
			if (!workspace) {
				throw new Error(`Kilo smoke test requires workspace ${expectedWorkspaceName}.`);
			}
			const primaryFolder = workspace.folders.find((folder) => folder.isPrimary);
			if (!primaryFolder)
				throw new Error(`Workspace ${expectedWorkspaceName} has no primary folder.`);
			const connection = (await invoke("kilo-code", "server.getConnection", {
				workspaceId: workspace.id,
			})) as {
				baseUrl: string;
				username: string;
				password: string;
				version: string;
				directory: string;
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
				directory: connection.directory,
				expectedDirectory: primaryFolder.path,
				eventOk: eventResponse.ok,
				eventContentType,
			};
		}, workspaceName);

		if (!result.healthOk || result.healthVersion !== result.connectionVersion) {
			throw new Error(
				`Expected authenticated Kilo health ${result.connectionVersion}, got ${result.healthVersion ?? "unhealthy"}.`,
			);
		}
		if (result.directory !== result.expectedDirectory) {
			throw new Error(
				`Expected Kilo directory ${result.expectedDirectory}, got ${result.directory || "no directory"}.`,
			);
		}
		if (!result.eventOk || !result.eventContentType.includes("text/event-stream")) {
			throw new Error(
				`Expected authenticated Kilo SSE, got ${result.eventContentType || "no content type"}.`,
			);
		}
	}
}
