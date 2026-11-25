import { KiloSettingsRpc } from "@kilocode/schema/kilocode/settings";

import type { PluginSdk } from "@kilo-desktop/kernel";

import { permissionRuleSchema, type ServerConnection } from "../../contracts";
import { callLocationRpc, createServerClient } from "../agent/server-client";
import type { KiloWorkStyleClient, WorkStyleOptions } from "./index";

/** The user's global Kilo config through `kilocode.settings`, in kilo.core's global directory's location. */
export function createKiloWorkStyleClient(connection: ServerConnection): KiloWorkStyleClient {
	const server = createServerClient(connection);
	const directory = connection.globalDirectory;
	const location = { location: { directory } };
	const settings = server.rpc(KiloSettingsRpc.Definition);
	const rpc = <T>(call: () => Promise<T>) => callLocationRpc(server, directory, call);
	return {
		async readGlobalPermissions() {
			const { document } = await rpc(() => settings.read({ scope: "global" }, location));
			const permissions = (document as { permissions?: unknown } | undefined)?.permissions;
			if (!Array.isArray(permissions)) return undefined;
			return permissions.flatMap((rule) => {
				const parsed = permissionRuleSchema.safeParse(rule);
				return parsed.success ? [parsed.data] : [];
			});
		},
		async writeGlobalPermissions(permissions) {
			await rpc(() =>
				settings.write({ scope: "global", set: { permissions: permissions as never } }, location),
			);
		},
		reload: () => server.location.reload(),
	};
}

/** Production wiring: the running Kilo v2 server. */
export function productionWorkStyleOptions(_sdk: PluginSdk): WorkStyleOptions {
	return { createClient: createKiloWorkStyleClient };
}
