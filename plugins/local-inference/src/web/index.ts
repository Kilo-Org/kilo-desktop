import type { SDK } from "@kilo-desktop/feature-sdk";
import { isAnacondaSignInGateForced } from "@kilo-desktop/sdk-react";

import type {
	LocalInferenceCapabilities,
	LocalInferenceServiceContract,
} from "../contracts/schemas.js";
import type { LocalInferenceAuthCapabilities } from "./auth-capabilities.js";

export { LocalModelServerSettings } from "./settings/LocalModelServerSettings.js";
export { LocalInferenceAuthProvider } from "./LocalInferenceAuthProvider.js";

export function webRegister(sdk: SDK): void {
	const service = {
		prepareModel: async (modelId: string) => {
			await (sdk.client as LocalInferenceServiceContract)["models.prepare"]({ modelId });
		},
		connect: async () => {
			await (sdk.client as LocalInferenceServiceContract)["runtime.connect"]();
		},
	} satisfies LocalInferenceCapabilities["localInference"];
	sdk.plugins.expose("localInference", service);

	sdk.tools.register({
		name: "settings.open",
		description:
			"Open the Local Model Server settings in the desktop app. Use this when the user asks " +
			"to view, configure, or manage their local model server or local model catalog. " +
			"Requires Anaconda sign-in before opening.",
		inputSchema: { type: "object", properties: {}, additionalProperties: false },
		exposeToModelContext: true,
		handler: async () => {
			if (isAnacondaSignInGateForced(sdk) || sdk.auth.peek().status !== "authenticated") {
				const authenticated = await sdk.plugins
					.get<LocalInferenceAuthCapabilities>("local-inference")
					?.authGate.requireSignIn();
				if (!authenticated) {
					throw new Error("Anaconda sign-in is required to view Local Model Server.");
				}
			}
			sdk.navigate("/settings/local-model-server");
			return { opened: true };
		},
	});
}
