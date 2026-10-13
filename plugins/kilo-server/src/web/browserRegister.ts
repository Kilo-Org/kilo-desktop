import { FeatureError, type MainSdk } from "@kilo-desktop/feature-sdk";

import { kiloServerContract, type KiloServerService } from "../contracts/schemas.js";

const UNAVAILABLE_MESSAGE = "Kilo Server requires the desktop app.";

const unavailable = (): never => {
	throw new FeatureError(UNAVAILABLE_MESSAGE, "BUSINESS");
};

export function kiloServerBrowserRegister(mainSdk: MainSdk): void {
	const service: KiloServerService = {
		"server.getConnection": async () => unavailable(),
		"server.restart": async () => unavailable(),
		"server.status": async () => ({
			status: "unavailable",
			message: UNAVAILABLE_MESSAGE,
		}),
		"externalClients.getState": async () => ({
			enabled: false,
			port: 0,
			defaultPort: 0,
			status: { status: "error", message: UNAVAILABLE_MESSAGE },
			clients: [],
		}),
		"externalClients.setEnabled": async () => unavailable(),
		"externalClients.setPort": async () => unavailable(),
		"externalClients.createClient": async () => unavailable(),
		"externalClients.revokeClient": async () => unavailable(),
		"agentToolSignIn.getState": async () => ({ declined: false }),
		"agentToolSignIn.decline": async () => unavailable(),
	};
	mainSdk.channels(kiloServerContract).handleAll(service);
}
