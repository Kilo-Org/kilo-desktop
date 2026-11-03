import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { KernelError, type DomainProvider, type PluginRegistration } from "@kilo-desktop/kernel";
import anacondaManifest from "@kilo-desktop/plugin-anaconda-account/plugin.json";
import {
	ANACONDA_ACCOUNT_DEFINITIONS,
	AnacondaAccount,
	type AnacondaAccountSession,
} from "@kilo-desktop/plugin-anaconda-account/contracts";

import { bootLocalInferenceHost, usageSnapshot } from "../../test/local-inference-host.js";
import { LocalModelServerSettings } from "../settings/LocalModelServerSettings.js";

const WAIT = { timeout: 10_000 };
const SIGNED_IN: AnacondaAccountSession = {
	status: "authenticated",
	user: { userId: "u1", email: "dev@anaconda.com" },
};

afterEach(() => {
	cleanup();
});

/** kilo.anaconda-account's domain object in main, driven by the test. */
function anacondaAccountPlugin() {
	let provider!: DomainProvider<typeof AnacondaAccount>;
	let signedIn = false;
	const signIn = vi.fn(async () => {
		signedIn = true;
		provider.update((state) => ({ ...state, session: SIGNED_IN }));
		provider.emit("changed", {});
		return { ok: true as const };
	});
	const cancelSignIn = vi.fn();
	const registration: PluginRegistration = {
		manifest: anacondaManifest,
		definitions: ANACONDA_ACCOUNT_DEFINITIONS,
		entry: {
			activate(sdk) {
				provider = sdk.domains.provide(AnacondaAccount, {
					initialState: { session: { status: "anonymous" }, signingIn: false },
					methods: {
						session: () => provider.state.session,
						refresh: () => provider.state.session,
						signIn,
						cancelSignIn,
						signOut: async () => ({ ok: true as const }),
						apiKey: () => null,
						siteDomain: () => "anaconda.com",
					},
				});
			},
		},
	};
	return {
		registration,
		signIn,
		isSignedIn: () => signedIn,
		rotateKey: () => provider.emit("changed", {}),
	};
}

async function openCatalog(anaconda: ReturnType<typeof anacondaAccountPlugin>) {
	const listCatalog = vi.fn(async () => {
		if (!anaconda.isSignedIn()) {
			throw new KernelError(
				"BUSINESS",
				"Sign in to your Anaconda account to view the model catalog.",
			);
		}
		return { models: [], total: 0 };
	});
	const host = await bootLocalInferenceHost({
		handlers: {
			listCatalog,
			status: async () => ({ status: "ready", loadedModelIds: [] }),
			usage: async () => usageSnapshot,
			hardwareProfile: async () => ({
				name: "Test machine",
				kind: "unified-memory",
				accelerator: "metal",
				memoryTotalBytes: 16 * 1024 ** 3,
				systemMemoryTotalBytes: 16 * 1024 ** 3,
				memoryBandwidthGBps: 100,
			}),
		},
		mainPlugins: [anaconda.registration],
	});
	host.render(<LocalModelServerSettings />);
	await page.getByRole("button", { name: "Add model" }).click();
	await page.getByRole("menuitem", { name: "From catalog" }).click();
	return { host, listCatalog };
}

describe("the model catalog and kilo.anaconda-account", () => {
	it("asks to sign in to Anaconda, signs in through the account and shows the catalog", async () => {
		const anaconda = anacondaAccountPlugin();
		const { listCatalog } = await openCatalog(anaconda);
		const dialog = page.getByRole("dialog", { name: "Local Model Catalog" });

		await expect.element(dialog.getByTestId("model-catalog-sign-in"), WAIT).toBeVisible();
		await dialog.getByTestId("model-catalog-sign-in-button").click();

		await vi.waitFor(() => expect(anaconda.signIn).toHaveBeenCalledTimes(1), WAIT);
		await expect.element(dialog.getByText("No models available"), WAIT).toBeVisible();
		expect(listCatalog.mock.calls.length).toBeGreaterThanOrEqual(2);
	});

	it("refetches the catalog when the account's key changes", async () => {
		const anaconda = anacondaAccountPlugin();
		const { listCatalog } = await openCatalog(anaconda);
		const dialog = page.getByRole("dialog", { name: "Local Model Catalog" });
		await dialog.getByTestId("model-catalog-sign-in-button").click();
		await expect.element(dialog.getByText("No models available"), WAIT).toBeVisible();
		const calls = listCatalog.mock.calls.length;

		anaconda.rotateKey();

		await vi.waitFor(() => expect(listCatalog.mock.calls.length).toBeGreaterThan(calls), WAIT);
	});
});
