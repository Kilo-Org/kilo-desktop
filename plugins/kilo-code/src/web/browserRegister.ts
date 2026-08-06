import { FeatureError, type MainSdk } from "@anaconda-agentic-desktop/feature-sdk";

import { kiloCodeContract, type KiloCodeService } from "../contracts/schemas.js";

const unavailable = (): never => {
	throw new FeatureError("Kilo Code requires the desktop app.", "BUSINESS");
};

export function kiloCodeBrowserRegister(mainSdk: MainSdk): void {
	const service: KiloCodeService = {
		"server.getConnection": async () => unavailable(),
		"server.restart": async () => unavailable(),
		"server.status": async () => ({
			status: "unavailable",
			message: "Kilo Code requires the desktop app.",
		}),
	};
	mainSdk.channels(kiloCodeContract).handleAll(service);
}
