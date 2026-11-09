import { describe, expect, it } from "vitest";

import { SettingsSection } from "@kilo-desktop/plugin-shell/contracts";

import { bootMarketplaceHost } from "../test/marketplace-host.js";
import { marketplaceWebEntry } from "./index.js";
import { MarketplaceSettings } from "./MarketplaceSettings.js";

const unused = () => Promise.reject(new Error("Not in this test."));

describe("kilo.marketplace's renderer entry", () => {
	it("contributes the Agent Behavior settings section", async () => {
		const host = await bootMarketplaceHost({
			handlers: {
				list: unused,
				refresh: unused,
				install: unused,
				remove: unused,
				authenticateMcp: unused,
				checkCommands: unused,
			},
			webEntry: marketplaceWebEntry,
		});

		const [section] = host.renderer.extensions.list(SettingsSection);
		expect(section?.key).toBe("kilo.marketplace/kilo-marketplace");
		expect(section?.metadata).toMatchObject({ title: "Agent Behavior", category: "kilo.shell/ai" });
		expect(section?.implementation?.component).toBe(MarketplaceSettings);
	});
});
