import { useMemo } from "react";
import { resource } from "@assistant-ui/tap";
import type { McpAppResource, McpAppsHost } from "@assistant-ui/react";
import { useSdk } from "@anaconda-agentic-desktop/sdk-react";

import type { McpAppsService } from "../../../contracts/mcp-apps/schemas.js";

/**
 * TAP resource implementing {@link McpAppsHost} via Electron IPC.
 *
 * Routes every MCP App data-plane operation through `sdk.client` → main
 * process → Kilo CLI HTTP API. Avoids the renderer ever reaching an MCP
 * server directly.
 */
function useKiloMcpAppsHost(): McpAppsHost {
	const sdk = useSdk<McpAppsService>("kilo-ui");

	return useMemo(
		(): McpAppsHost => ({
			async loadResource(params) {
				const result = await sdk.client["mcpApps.readAppResource"](params);
				return result as McpAppResource;
			},
			async callTool(params) {
				return sdk.client["mcpApps.callTool"](params);
			},
			async readResource(params) {
				return sdk.client["mcpApps.readResource"](params);
			},
			async listResources(params) {
				// McpAppsHost types params as `unknown`; narrow to the contract's
				// `{ serverId?: string } | undefined` instead of blind-casting.
				const serverId =
					params && typeof params === "object" && "serverId" in params
						? (params as { serverId?: unknown }).serverId
						: undefined;
				return sdk.client["mcpApps.listResources"](
					typeof serverId === "string" && serverId.length > 0 ? { serverId } : undefined,
				);
			},
		}),
		[sdk],
	);
}

export const KiloMcpAppsHost = resource(useKiloMcpAppsHost);
