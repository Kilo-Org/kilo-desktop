import type { SDK } from "@anaconda-agentic-desktop/feature-sdk";

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
	} satisfies LocalInferenceCapabilities["localInference"];
	sdk.plugins.expose("localInference", service);
}
