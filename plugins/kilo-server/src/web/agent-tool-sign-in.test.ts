import { describe, expect, it, vi } from "vitest";

import { createFakeSdk } from "@kilo-desktop/testing";

import {
	AGENT_TOOL_SIGN_IN_CHANGED_EVENT,
	kiloServerContract,
	type KiloServerWebCapabilities,
} from "../contracts/schemas.js";
import { webRegister } from "./index.js";

function setup() {
	const decline = vi.fn(async () => ({ declined: true }));
	const sdk = createFakeSdk({
		featureId: "kilo-server",
		channels: kiloServerContract,
		handlers: {
			"agentToolSignIn.getState": async () => ({ declined: false }),
			"agentToolSignIn.decline": decline,
		},
	});
	webRegister(sdk);
	const capability = sdk.plugins.get<KiloServerWebCapabilities>("kilo-server")!.agentToolSignIn;
	return { sdk, capability, decline };
}

describe("agentToolSignIn capability", () => {
	it("reads the sign-in state from main", async () => {
		const { capability } = setup();

		await expect(capability.getState()).resolves.toEqual({ declined: false });
	});

	it("records a decline in main", async () => {
		const { capability, decline } = setup();

		await expect(capability.decline()).resolves.toEqual({ declined: true });
		expect(decline).toHaveBeenCalledOnce();
	});

	it("passes main's change announcements to subscribers, ignoring malformed ones", () => {
		const { sdk, capability } = setup();
		const listener = vi.fn();
		const unsubscribe = capability.subscribe(listener);

		sdk.events.emit(AGENT_TOOL_SIGN_IN_CHANGED_EVENT, { declined: true });
		sdk.events.emit(AGENT_TOOL_SIGN_IN_CHANGED_EVENT, { declined: "yes" });
		unsubscribe();
		sdk.events.emit(AGENT_TOOL_SIGN_IN_CHANGED_EVENT, { declined: false });

		expect(listener.mock.calls).toEqual([[{ declined: true }]]);
	});
});
