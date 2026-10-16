import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { FeatureError } from "@kilo-desktop/feature-sdk";
import { SdkProvider } from "@kilo-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeSdk } from "@kilo-desktop/testing";
import { Toaster, toast } from "@kilo-desktop/ui/components/sonner";

import { kiloServerContract, type KiloGlobalConfigFile } from "../../contracts/schemas.js";
import { GlobalKiloConfigRow } from "./GlobalKiloConfigRow.js";

const CONFIG_PATH = "/Users/me/.config/kilo/kilo.jsonc";

function renderRow(
	resolveFile: () => Promise<KiloGlobalConfigFile>,
	showItemInFolder = vi.fn(async (_path: string) => ({ revealed: true })),
) {
	const sdk = createFakeSdk({
		featureId: "kilo-server",
		channels: kiloServerContract,
		handlers: { "config.globalConfigFile": resolveFile },
		shell: { showItemInFolder },
	});
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(
		<QueryClientProvider client={client}>
			<SdkProvider system={createFakeFeatureSystem({ sdks: { "kilo-server": sdk } })}>
				<GlobalKiloConfigRow />
				<Toaster />
			</SdkProvider>
		</QueryClientProvider>,
	);
	return { showItemInFolder };
}

afterEach(() => {
	cleanup();
	toast.dismiss();
});

describe("GlobalKiloConfigRow", () => {
	it("shows the global config path and reveals it in the file manager", async () => {
		const { showItemInFolder } = renderRow(async () => ({ path: CONFIG_PATH, exists: true }));

		await expect.element(page.getByText("Kilo config", { exact: true })).toBeVisible();
		await expect.element(page.getByText(CONFIG_PATH, { exact: true })).toBeVisible();
		await page.getByTestId("about-show-global-kilo-config").click();

		await vi.waitFor(() => expect(showItemInFolder).toHaveBeenCalledWith(CONFIG_PATH));
		await expect
			.element(page.getByText("Could not show the Kilo config file"))
			.not.toBeInTheDocument();
	});

	it("disables the action until the global config file exists", async () => {
		renderRow(async () => ({ path: CONFIG_PATH, exists: false }));

		await expect
			.element(page.getByText("No global config file has been created yet."))
			.toBeVisible();
		await expect.element(page.getByTestId("about-show-global-kilo-config")).toBeDisabled();
	});

	it("reports when the file manager cannot reveal the config", async () => {
		renderRow(
			async () => ({ path: CONFIG_PATH, exists: true }),
			vi.fn(async () => ({ revealed: false })),
		);

		await page.getByTestId("about-show-global-kilo-config").click();

		await expect.element(page.getByText("Could not show the Kilo config file")).toBeVisible();
	});

	it("explains when the config location is unavailable", async () => {
		renderRow(async () => {
			throw new FeatureError("Kilo Server requires the desktop app.", "BUSINESS");
		});

		await expect.element(page.getByText("Kilo Server requires the desktop app.")).toBeVisible();
		await expect.element(page.getByTestId("about-show-global-kilo-config")).toBeDisabled();
	});
});
