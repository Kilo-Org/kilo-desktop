import { describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { KernelDataCollection, KernelError, KernelOs } from "@kilo-desktop/kernel";

import { renderShell } from "../../testing";

async function openPrivacy(
	options: {
		desktop?: boolean;
		consent?: boolean;
		setChoice?: (allowed: boolean) => void;
	} = {},
) {
	const openExternal = vi.fn(() => true);
	await renderShell([], {
		desktop: options.desktop ?? true,
		beforeRender: (main) => {
			main.kernelSdk.domainObjects.provide(KernelOs, {
				initialState: {},
				methods: {
					openExternal,
					showItemInFolder: () => {},
					showLogs: () => ({ revealed: true }),
					logFilePath: () => "/logs/main.log",
				},
			});
			if (options.consent === undefined) return;
			const consent = main.kernelSdk.domainObjects.provide(KernelDataCollection, {
				initialState: {
					choice: options.consent,
					allowed: options.consent,
					installationId: "install-1",
					environment: "preview",
				},
				methods: {
					setChoice: ({ allowed }) => {
						options.setChoice?.(allowed);
						consent.setState({ ...consent.state, choice: allowed, allowed });
					},
				},
			});
		},
	});
	if (options.desktop !== false) window.location.hash = "#/settings/privacy";
	return { openExternal };
}

const toggle = () => page.getByTestId("privacy-data-collection");

describe("Privacy settings", () => {
	it("shows the saved choice and saves a change", async () => {
		const setChoice = vi.fn();
		await openPrivacy({ consent: true, setChoice });

		await expect.element(toggle()).toHaveAttribute("aria-checked", "true");
		await toggle().click();

		await expect.element(toggle()).toHaveAttribute("aria-checked", "false");
		expect(setChoice).toHaveBeenCalledWith(false);
	});

	it("explains a failed change and keeps showing what was saved", async () => {
		await openPrivacy({
			consent: true,
			setChoice: () => {
				throw new KernelError("BUSINESS", "Could not save data collection preference.");
			},
		});

		await toggle().click();

		await expect
			.element(page.getByText("Could not save data collection preference."))
			.toBeVisible();
		await expect.element(toggle()).toHaveAttribute("aria-checked", "true");
	});

	it("shows a placeholder until consent is known", async () => {
		await openPrivacy();

		await expect
			.element(page.getByRole("status", { name: "Loading privacy settings" }))
			.toBeVisible();
	});

	it("opens the free-model data handling docs in the browser", async () => {
		const { openExternal } = await openPrivacy({ consent: true });

		await page.getByText("here", { exact: true }).click();

		await vi.waitFor(() =>
			expect(openExternal).toHaveBeenCalledWith(
				{ url: "https://kilo.ai/docs/getting-started/using-kilo-for-free" },
				expect.anything(),
			),
		);
	});

	it("is only offered in the desktop app", async () => {
		await openPrivacy({ desktop: false, consent: false });
		await page.getByTestId("nav-settings").click();

		await expect.element(page.getByTestId("settings-section-appearance")).toBeVisible();
		await expect.element(page.getByTestId("settings-section-privacy")).not.toBeInTheDocument();
	});
});
