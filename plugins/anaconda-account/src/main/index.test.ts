import { describe, expect, it, vi } from "vitest";

import { createFakeMainSdk, createLinkedFakeSdkPair } from "@kilo-desktop/testing";

import { mainRegister } from "./index.js";

function bootWithShellAuth(apiKey: string | null) {
	const linked = createLinkedFakeSdkPair({ featureId: "anaconda-account" });
	const mainSdk = createFakeMainSdk({
		featureId: "anaconda-account",
		services: linked.rendererSdk.services,
		fetch: async () =>
			new Response(JSON.stringify({ passport: { profile: { email: "ada@example.com" } } }), {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
	});
	let storedKey = apiKey;
	const deleteApiKey = vi.fn(async () => {
		storedKey = null;
	});
	// Stand-in for the shell's `auth` capability (registered under feature id "auth").
	linked.createMainSdk("auth").plugins.expose("session", {
		getApiKey: async () => storedKey,
		getOAuthSettings: async () => ({ domain: "anaconda.test", clientId: "client" }),
		saveApiKey: async (key: string) => {
			storedKey = key;
		},
		deleteApiKey,
	});
	mainRegister(mainSdk);
	return { mainSdk, deleteApiKey };
}

describe("anaconda-account mainRegister", () => {
	it("resolves the session through the shell auth capability", async () => {
		const { mainSdk } = bootWithShellAuth("api-key");

		await expect(mainSdk.invoke("session.get")).resolves.toEqual({
			status: "authenticated",
			user: { email: "ada@example.com" },
		});
	});

	it("signs out via the shell and emits anaconda-account.changed", async () => {
		const { mainSdk, deleteApiKey } = bootWithShellAuth("api-key");
		await mainSdk.invoke("session.get");
		const changed = vi.fn();
		mainSdk.events.on("anaconda-account.changed", changed);

		await expect(mainSdk.invoke("logout")).resolves.toEqual({ status: "anonymous" });

		expect(deleteApiKey).toHaveBeenCalledTimes(1);
		expect(changed).toHaveBeenCalledWith({ status: "anonymous" });
	});

	it("reports sign-in unavailable when the host cannot open a browser", async () => {
		// createFakeMainSdk has no `host` unless one is passed — like browser mode.
		const { mainSdk } = bootWithShellAuth(null);

		await expect(mainSdk.invoke("login")).resolves.toEqual({
			status: "error",
			reason: "Anaconda sign-in is unavailable.",
		});
	});

	it("unregisters its channels on dispose", () => {
		const { mainSdk } = bootWithShellAuth("api-key");

		mainSdk.dispose();

		expect(mainSdk.has("session.get")).toBe(false);
	});
});
