import { getPage } from "@anaconda/playwright-utils/page-utils";

export class KiloCodePage {
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

			const workspaces = (await invoke("workspaces", "list")) as Array<{ id: string }>;
			if (!workspaces[0]) throw new Error("Kilo smoke test requires a workspace.");
			const connection = (await invoke("kilo-code", "server.getConnection", {
				workspaceId: workspaces[0].id,
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
				hasDirectory: connection.directory.length > 0,
				eventOk: eventResponse.ok,
				eventContentType,
			};
		});

		if (!result.healthOk || result.healthVersion !== result.connectionVersion) {
			throw new Error(
				`Expected authenticated Kilo health ${result.connectionVersion}, got ${result.healthVersion ?? "unhealthy"}.`,
			);
		}
		if (!result.hasDirectory)
			throw new Error("Kilo connection did not include a workspace directory.");
		if (!result.eventOk || !result.eventContentType.includes("text/event-stream")) {
			throw new Error(
				`Expected authenticated Kilo SSE, got ${result.eventContentType || "no content type"}.`,
			);
		}
	}
}
