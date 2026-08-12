import { FeatureError, type MainSdk } from "@anaconda-agentic-desktop/feature-sdk";

import { kiloServerContract, type KiloServerService } from "../contracts/schemas.js";

const unavailable = (): never => {
	throw new FeatureError("Kilo Server requires the desktop app.", "BUSINESS");
};

export function kiloServerBrowserRegister(mainSdk: MainSdk): void {
	const service: KiloServerService = {
		"server.getConnection": async () => unavailable(),
		"server.restart": async () => unavailable(),
		"server.status": async () => ({
			status: "unavailable",
			message: "Kilo Server requires the desktop app.",
		}),
	};
	mainSdk.channels(kiloServerContract).handleAll(service);
}
