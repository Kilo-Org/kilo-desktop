import type { SDK } from "@kilo-desktop/feature-sdk";

import type {
	LocalInferenceCapabilities,
	LocalInferenceServiceContract,
} from "../contracts/schemas.js";

export { LocalModelServerSettings } from "./settings/LocalModelServerSettings.js";

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
			"to view, configure, or manage their local model server or local model catalog.",
		inputSchema: { type: "object", properties: {}, additionalProperties: false },
		exposeToModelContext: true,
		handler: async () => {
			sdk.navigate("/settings/local-model-server");
			return { opened: true };
		},
	});
}
