import { KernelCommand, type PluginSdk } from "@kilo-desktop/kernel";
import { KiloServer } from "@kilo-desktop/plugin-core/contracts";

import { SupportRow } from "../../contracts";
import { KiloConfigRow } from "./KiloConfigRow";
import { noticeServerFailures } from "./server-failure-notice";

/**
 * Support for the Kilo server: where the user's Kilo config lives (About →
 * Support), a notice while the server is down and the command restarting it.
 */
export function activateSupport(sdk: PluginSdk): void {
	sdk.extensions.implement(SupportRow, "kilo-config", KiloConfigRow);
	sdk.extensions.implement(KernelCommand, "restart-server", () =>
		sdk.domainObjects.get(KiloServer)?.methods.restart(undefined),
	);
	if (!sdk.context.get("kernel/secondaryWindow")) noticeServerFailures(sdk);
}
