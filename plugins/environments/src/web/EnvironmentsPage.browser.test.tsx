import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import { SdkProvider } from "@anaconda-agentic-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeSdk } from "@anaconda-agentic-desktop/testing";

import { EnvironmentsPage } from "./EnvironmentsPage";

function renderPage(options: { flagEnabled?: boolean } = {}) {
	const flagEnabled = options.flagEnabled ?? true;
	const flags: Record<string, unknown> = { "environments-feature": flagEnabled };
	const sdk = createFakeSdk({
		featureId: "environments",
		featureFlags: {
			getAllFlags: async () => flags,
			subscribe: (fn) => {
				fn(flags);
				return () => {};
			},
			peek: () => flags,
		},
	});
	const system = createFakeFeatureSystem({ sdks: { environments: sdk } });
	return render(
		<SdkProvider system={system}>
			<EnvironmentsPage />
		</SdkProvider>,
	);
}

afterEach(() => {
	cleanup();
});

describe("EnvironmentsPage", () => {
	it("renders the empty state when the feature flag is on", async () => {
		const { baseElement } = renderPage({ flagEnabled: true });
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByRole("heading", { name: "Environments" })).toBeVisible();
		await expect.element(screen.getByText(/no environment providers available/i)).toBeVisible();
	});

	describe("feature flag gate (environments-feature)", () => {
		it("renders the not-available message when the flag is off", async () => {
			const { baseElement } = renderPage({ flagEnabled: false });
			const screen = page.elementLocator(baseElement);

			const root = screen.getByTestId("environments-page");
			await expect.element(root).toHaveAttribute("data-state", "flag-off");

			await expect.element(screen.getByTestId("environments-flag-off-message")).toBeVisible();
			await expect.element(screen.getByTestId("environments-empty-state")).not.toBeInTheDocument();
		});

		it("renders the normal empty state when the flag is on", async () => {
			const { baseElement } = renderPage({ flagEnabled: true });
			const screen = page.elementLocator(baseElement);

			const root = screen.getByTestId("environments-page");
			await expect.element(root).not.toHaveAttribute("data-state", "flag-off");
			await expect.element(screen.getByTestId("environments-empty-state")).toBeVisible();
			await expect
				.element(screen.getByTestId("environments-flag-off-message"))
				.not.toBeInTheDocument();
		});
	});
});
