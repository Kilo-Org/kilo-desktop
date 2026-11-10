import { createKiloClient, type KiloClientConfig } from "@kilocode/sdk/v2/client";

import type { PluginSdk } from "@kilo-desktop/kernel";

import type { ServerConnection } from "../../contracts";
import type { KiloWorkStyleClient, WorkStyleOptions } from "./index";
import type { PermissionConfig } from "./work-style-presets";

type GlobalConfigUpdate = NonNullable<
	NonNullable<
		Parameters<ReturnType<typeof createKiloClient>["global"]["config"]["update"]>[0]
	>["config"]
>;

/** The global config API of a running Kilo server, through its SDK, scoped to its global directory. */
export function createKiloWorkStyleClient(connection: ServerConnection): KiloWorkStyleClient {
	const credentials = Buffer.from(`${connection.username}:${connection.password}`).toString(
		"base64",
	);
	const config: KiloClientConfig & { directory: string } = {
		baseUrl: connection.baseUrl,
		headers: { Authorization: `Basic ${credentials}` },
		directory: connection.globalDirectory,
	};
	const client = createKiloClient(config);
	const options = { throwOnError: true } as const;
	return {
		async readGlobalPermission() {
			const { data } = await client.global.config.get(options);
			return (data as { permission?: PermissionConfig } | undefined)?.permission;
		},
		async updateGlobalConfig(patch) {
			// Kilo deep-merges the patch; its `null`s delete, which the SDK's config type can't express.
			await client.global.config.update({ config: patch as GlobalConfigUpdate }, options);
		},
		async disposeInstances() {
			await client.global.dispose();
		},
	};
}

/** Production wiring: the real Kilo SDK client. */
export function productionWorkStyleOptions(_sdk: PluginSdk): WorkStyleOptions {
	return { createClient: createKiloWorkStyleClient };
}
