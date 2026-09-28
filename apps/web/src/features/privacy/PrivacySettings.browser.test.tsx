import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { privacyChannels } from "@kilo-desktop/contracts";
import type { ChannelHandlerMap } from "@kilo-desktop/feature-sdk";
import { FeatureError } from "@kilo-desktop/feature-sdk";
import { SdkProvider } from "@kilo-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeSdk } from "@kilo-desktop/testing";
import { PrivacySettings } from "./PrivacySettings";

afterEach(cleanup);

function renderSettings(handlers: ChannelHandlerMap<typeof privacyChannels>) {
	const sdk = createFakeSdk({ featureId: "privacy", channels: privacyChannels, handlers });
	const system = createFakeFeatureSystem({ sdks: { privacy: sdk } });
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const { baseElement } = render(
		<SdkProvider system={system}>
			<QueryClientProvider client={client}>
				<PrivacySettings />
			</QueryClientProvider>
		</SdkProvider>,
	);
	const screen = page.elementLocator(baseElement);
	return { sdk, screen, toggle: screen.getByTestId("privacy-data-collection") };
}

describe("Privacy settings", () => {
	it("shows the saved preference and lets the user opt out", async () => {
		let allowDataCollection = true;
		const set = vi.fn((input: { allowDataCollection: boolean }) => {
			allowDataCollection = input.allowDataCollection;
			return input;
		});
		const { screen, toggle } = renderSettings({ get: () => ({ allowDataCollection }), set });

		await expect.element(toggle).toBeChecked();
		await expect
			.element(screen.getByRole("switch", { name: "Share usage analytics and crash reports" }))
			.toBeEnabled();
		await toggle.click();
		await expect.element(toggle).not.toBeChecked();
		expect(set).toHaveBeenCalledWith({ allowDataCollection: false });
	});

	it("shows the new choice immediately and keeps the switch usable while it is applied", async () => {
		let allowDataCollection = true;
		let finish!: () => void;
		const { toggle } = renderSettings({
			get: () => ({ allowDataCollection }),
			set: (input) =>
				new Promise((resolve) => {
					finish = () => {
						allowDataCollection = input.allowDataCollection;
						resolve(input);
					};
				}),
		});

		await expect.element(toggle).toBeChecked();
		await toggle.click();
		await expect.element(toggle).not.toBeChecked();
		await expect.element(toggle).toBeEnabled();
		finish();
		await expect.element(toggle).not.toBeChecked();
	});

	it("reflects a change made in another window", async () => {
		let allowDataCollection = true;
		const { sdk, toggle } = renderSettings({
			get: () => ({ allowDataCollection }),
			set: (input) => input,
		});

		await expect.element(toggle).toBeChecked();
		allowDataCollection = false;
		sdk.events.emit("changed", { allowDataCollection: false });
		await expect.element(toggle).not.toBeChecked();
	});

	it("shows a failed change and keeps the authoritative preference", async () => {
		const { screen, toggle } = renderSettings({
			get: () => ({ allowDataCollection: false }),
			set: () => {
				throw new FeatureError("Could not save data collection preference.");
			},
		});

		await expect.element(toggle).toBeEnabled();
		await toggle.click();
		await expect
			.element(screen.getByText("Could not save data collection preference."))
			.toBeVisible();
		await expect.element(toggle).not.toBeChecked();
	});

	it("disables the switch when the preference cannot be loaded", async () => {
		const { screen, toggle } = renderSettings({
			get: () => {
				throw new FeatureError("Privacy settings are unavailable.");
			},
			set: (input) => input,
		});

		await expect.element(screen.getByText("Privacy settings are unavailable.")).toBeVisible();
		await expect.element(toggle).toBeDisabled();
	});
});
