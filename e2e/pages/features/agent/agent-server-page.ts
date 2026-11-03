import { click, getLocatorByTestId } from "@anaconda/playwright-utils";
import { getPage } from "@anaconda/playwright-utils/page-utils";

import { agentData } from "../../../testdata/agent.js";
import { callDomainMethod } from "../../../utils/kernel-domains.js";

interface ServerConnection {
	readonly baseUrl: string;
	readonly username: string;
	readonly password: string;
	readonly version: string;
	readonly globalDirectory: string;
}

export class AgentServerPage {
	/** Opens Settings → Diagnostics on its Services tab. */
	async openDiagnostics(): Promise<void> {
		await getPage().evaluate(() => {
			globalThis.location.hash = "#/settings/diagnostics";
		});
		await click(getLocatorByTestId("diagnostics-tab-services"));
	}

	/** The Kilo server shows as a ready service in Settings → Diagnostics. */
	async verifyServerReadyInDiagnostics(): Promise<void> {
		await getLocatorByTestId(`diagnostics-service-${agentData.serviceKey}`)
			.getByText("ready", { exact: true })
			.waitFor({ state: "visible", timeout: agentData.serverReadyTimeoutMs });
	}

	/** The packaged CLI answers authenticated health and event-stream requests. */
	async verifyAuthenticatedServerTransport(): Promise<void> {
		const connection = (await callDomainMethod(
			agentData.serverDomain,
			"connect",
			undefined,
			"kilo.agent",
		)) as ServerConnection;
		const result = await getPage().evaluate(async (connection) => {
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
				eventOk: eventResponse.ok,
				eventContentType,
			};
		}, connection);

		if (!result.healthOk || result.healthVersion !== connection.version) {
			throw new Error(
				`Expected authenticated Kilo health ${connection.version}, got ${result.healthVersion ?? "unhealthy"}.`,
			);
		}
		if (!connection.globalDirectory) {
			throw new Error("Expected the Kilo connection to expose its global directory.");
		}
		if (!result.eventOk || !result.eventContentType.includes("text/event-stream")) {
			throw new Error(
				`Expected authenticated Kilo SSE, got ${result.eventContentType || "no content type"}.`,
			);
		}
	}
}
