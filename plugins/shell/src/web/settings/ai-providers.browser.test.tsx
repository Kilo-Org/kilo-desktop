import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import type { PluginSdk } from "@kilo-desktop/kernel";
import { Models, type ModelsState } from "@kilo-desktop/plugin-core/contracts";

import { AiProviderPanel } from "../../contracts";
import { contributor, renderShell } from "../../testing";

function providerPanels() {
	return contributor(
		"acme.providers",
		{
			"kilo.shell/ai-provider-panel": [
				{ id: "local", aiProviderId: "local-server" },
				{ id: "gateway", aiProviderId: "acme-gateway" },
			],
		},
		(sdk) => {
			sdk.extensions.implement(AiProviderPanel, "local", () => <p>Local model server</p>);
			sdk.extensions.implement(AiProviderPanel, "gateway", () => <p>Acme Gateway</p>);
		},
	);
}

/** kilo.core's models with no AI providers, so the provider list renders. */
function coreWithModels(sdk: PluginSdk) {
	const initialState: ModelsState = {
		ready: true,
		followingAccount: false,
		aiProviders: {},
		models: {},
		defaults: {},
		preferences: { byAgent: {}, variants: {}, recent: [], favorites: [], autoFreeModels: true },
		gatewayCatalog: { details: [], fetchedAt: null },
	};
	const unused = async () => {
		throw new Error("not used");
	};
	sdk.domainObjects.provide(Models, {
		initialState,
		methods: {
			connectAiProvider: unused,
			disconnectAiProvider: unused,
			saveCustomAiProvider: unused,
			customAiProvider: async () => null,
			refresh: () => undefined,
			presentEnv: async () => ({ names: [] }),
			refreshGatewayCatalog: () => undefined,
			remember: () => undefined,
			recordRecent: () => undefined,
			setFavorite: () => undefined,
			setAutoFreeModels: () => undefined,
		},
	});
}

describe("AI Providers settings", () => {
	it("sits under AI, with the contributed AI provider panels first in the providers panel", async () => {
		await renderShell([providerPanels()], { core: coreWithModels });
		window.location.hash = "#/settings/ai-providers";

		await expect
			.element(page.getByTestId("settings-section-heading"))
			.toHaveTextContent("AI Providers");
		const ai = page.getByTestId("settings-group-ai").element().parentElement!;
		expect(ai.contains(page.getByTestId("settings-section-ai-providers").element())).toBe(true);
		const panels = page.getByTestId("ai-provider-panels");
		await expect.element(panels.getByText("Local model server")).toBeVisible();
		await expect.element(panels.getByText("Acme Gateway")).toBeVisible();
		// As origin: "Add AI Provider" sits in the page header, and the panels
		// are the first rows of the one providers panel, not a card above it.
		const header = page.getByTestId("settings-section-heading").element().closest("header")!;
		expect(header.contains(page.getByTestId("kilo-providers-add-provider").element())).toBe(true);
		const inventory = page.getByTestId("kilo-providers-inventory").element();
		expect(inventory.firstElementChild).toBe(panels.element());
	});
});
