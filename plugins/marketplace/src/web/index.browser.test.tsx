import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import { type KernelLogger } from "@kilo-desktop/kernel";
import { createTestKernelPair } from "@kilo-desktop/kernel/testing";
import { KernelProvider } from "@kilo-desktop/kernel/web";
import { SettingsSection } from "@kilo-desktop/plugin-shell/contracts";
import { TooltipProvider } from "@kilo-desktop/ui/components/tooltip";

import manifest from "../../plugin.json";
import { MARKETPLACE_DEFINITIONS } from "../contracts/index";
import { bootMarketplaceHost } from "../test/marketplace-host";
import { marketplaceWebEntry } from "./index";
import { MarketplaceSettings } from "./MarketplaceSettings";

const unused = () => Promise.reject(new Error("Not in this test."));

function recordingLogger() {
	const warnings: unknown[][] = [];
	const errors: unknown[][] = [];
	const logger: KernelLogger = {
		debug: () => {},
		info: () => {},
		warn: (...args) => void warnings.push(args),
		error: (...args) => void errors.push(args),
	};
	return { logger, warnings, errors };
}

describe("kilo.marketplace's renderer entry", () => {
	it("contributes the Agent Behavior settings section", async () => {
		const host = await bootMarketplaceHost({
			handlers: {
				list: unused,
				refresh: unused,
				preview: unused,
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

	it("activates and renders without kilo.core, kilo.work-sessions, kilo.chat and kilo.shell, logging no errors", async () => {
		cleanup();
		const { logger, errors } = recordingLogger();
		const { main, renderer } = await createTestKernelPair({
			// No main entry either: the window copes while the Marketplace itself is absent.
			main: [{ manifest, definitions: MARKETPLACE_DEFINITIONS }],
			renderer: [{ manifest, definitions: MARKETPLACE_DEFINITIONS, entry: marketplaceWebEntry }],
			logger,
		});
		await main.flush();

		render(
			<KernelProvider kernel={renderer} as={manifest.id}>
				<QueryClientProvider
					client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
				>
					<TooltipProvider>
						<MarketplaceSettings />
					</TooltipProvider>
				</QueryClientProvider>
			</KernelProvider>,
		);

		await expect.element(page.getByTestId("marketplace-page")).toBeVisible();
		await expect.element(page.getByText("The Marketplace is unavailable.")).toBeVisible();
		expect(errors).toEqual([]);
		await main.stop();
	});
});
