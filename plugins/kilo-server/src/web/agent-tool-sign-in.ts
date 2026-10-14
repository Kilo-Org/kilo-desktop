import type { SDK } from "@kilo-desktop/feature-sdk";

import {
	AGENT_TOOL_SIGN_IN_CHANGED_EVENT,
	agentToolSignInStateSchema,
	type AgentToolSignInCapability,
	type KiloServerService,
} from "../contracts/schemas.js";

/** Backs the `agentToolSignIn` capability with kilo-server's main contract and change event. */
export function createAgentToolSignInCapability(
	sdk: SDK<KiloServerService>,
): AgentToolSignInCapability {
	return {
		getState: () => sdk.client["agentToolSignIn.getState"](),
		decline: (scope) => sdk.client["agentToolSignIn.decline"]({ scope }),
		subscribe(listener) {
			return sdk.events.on(`${sdk.featureId}.${AGENT_TOOL_SIGN_IN_CHANGED_EVENT}`, (payload) => {
				const parsed = agentToolSignInStateSchema.safeParse(payload);
				if (parsed.success) listener(parsed.data);
			});
		},
	};
}
