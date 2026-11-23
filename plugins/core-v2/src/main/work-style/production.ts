import type { PluginSdk } from "@kilo-desktop/kernel";

import type { ServerConnection } from "../../contracts";
import { createServerClient, globalSettings, type SettingsValue } from "../server-client";
import type { KiloWorkStyleClient, WorkStyleOptions } from "./index";
import type { PermissionRule } from "./work-style-presets";

function isRule(value: unknown): value is PermissionRule {
	if (!value || typeof value !== "object") return false;
	const rule = value as Record<string, unknown>;
	return (
		typeof rule.action === "string" &&
		typeof rule.resource === "string" &&
		(rule.effect === "allow" || rule.effect === "ask" || rule.effect === "deny")
	);
}

/** The global `permissions` of Desktop's Kilo v2 server, through the `kilocode.settings` RPC. */
export function createKiloWorkStyleClient(
	connection: ServerConnection,
	fetch: typeof globalThis.fetch = globalThis.fetch,
): KiloWorkStyleClient {
	const settings = globalSettings(
		createServerClient(connection, fetch),
		connection.globalDirectory,
	);
	return {
		async readGlobalPermissions() {
			const { permissions } = await settings.read();
			return Array.isArray(permissions) ? permissions.filter(isRule) : undefined;
		},
		async writeGlobalPermissions(permissions) {
			await settings.write({ permissions: permissions as unknown as SettingsValue });
		},
	};
}

/** Production wiring: Desktop's Kilo v2 server. */
export function productionWorkStyleOptions(_sdk: PluginSdk): WorkStyleOptions {
	return { createClient: createKiloWorkStyleClient };
}
