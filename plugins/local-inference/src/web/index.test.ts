import { describe, expect, it, vi } from "vitest";

import type { AuthSession } from "@kilo-desktop/feature-sdk";
import { createFakeSdk } from "@kilo-desktop/testing";

import type { LocalInferenceAuthCapabilities } from "./auth-capabilities.js";
import { webRegister } from "./index.js";

const inlineAuthActions = { signIn: async () => true, cancel: () => undefined };

describe("local-inference web entry", () => {
	it("waits for Anaconda sign-in before opening Local Model Server from chat", async () => {
		const navigate = vi.fn();
		const requireSignIn = vi.fn(async () => true);
		const sdk = createFakeSdk({ featureId: "local-inference", navigation: { navigate } });
		sdk.plugins.expose("authGate", {
			requireSignIn,
			...inlineAuthActions,
		} satisfies LocalInferenceAuthCapabilities["authGate"]);
		webRegister(sdk);

		await sdk.services.toolRegistry.invoke("local-inference", "settings.open", {});

		expect(requireSignIn).toHaveBeenCalledOnce();
		expect(navigate).toHaveBeenCalledWith("/settings/local-model-server", undefined);
	});

	it("does not navigate when Local Model Server sign-in is dismissed", async () => {
		const navigate = vi.fn();
		const sdk = createFakeSdk({ featureId: "local-inference", navigation: { navigate } });
		sdk.plugins.expose("authGate", {
			requireSignIn: async () => false,
			...inlineAuthActions,
		} satisfies LocalInferenceAuthCapabilities["authGate"]);
		webRegister(sdk);

		await expect(
			sdk.services.toolRegistry.invoke("local-inference", "settings.open", {}),
		).rejects.toThrow("Anaconda sign-in is required");
		expect(navigate).not.toHaveBeenCalled();
	});

	it("opens Local Model Server directly for authenticated users", async () => {
		const session: AuthSession = { status: "authenticated", user: { username: "ada" } };
		const navigate = vi.fn();
		const requireSignIn = vi.fn(async () => true);
		const sdk = createFakeSdk({
			featureId: "local-inference",
			auth: { peek: () => session },
			navigation: { navigate },
		});
		sdk.plugins.expose("authGate", {
			requireSignIn,
			...inlineAuthActions,
		} satisfies LocalInferenceAuthCapabilities["authGate"]);
		webRegister(sdk);

		await sdk.services.toolRegistry.invoke("local-inference", "settings.open", {});

		expect(requireSignIn).not.toHaveBeenCalled();
		expect(navigate).toHaveBeenCalledWith("/settings/local-model-server", undefined);
	});

	it("forces the sign-in gate for authenticated users when the test flag is set", async () => {
		const session: AuthSession = { status: "authenticated", user: { username: "ada" } };
		const navigate = vi.fn();
		const requireSignIn = vi.fn(async () => true);
		const sdk = createFakeSdk({
			featureId: "local-inference",
			auth: { peek: () => session },
			featureFlags: { peek: () => ({ "force-anaconda-sign-in-gate": true }) },
			navigation: { navigate },
		});
		sdk.plugins.expose("authGate", {
			requireSignIn,
			...inlineAuthActions,
		} satisfies LocalInferenceAuthCapabilities["authGate"]);
		webRegister(sdk);

		await sdk.services.toolRegistry.invoke("local-inference", "settings.open", {});

		expect(requireSignIn).toHaveBeenCalledOnce();
		expect(navigate).toHaveBeenCalledWith("/settings/local-model-server", undefined);
	});
});
