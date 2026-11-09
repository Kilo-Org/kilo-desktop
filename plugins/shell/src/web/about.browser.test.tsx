import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { KernelError, KernelOs } from "@kilo-desktop/kernel";
import { toast } from "@kilo-desktop/ui/components/sonner";

import { AboutSection, SupportRow } from "../contracts";
import { contributor, renderShell } from "./test-support";

interface OsFake {
	showLogs?: () => { revealed: boolean };
	logFilePath?: () => string | Promise<string>;
}

async function openAbout(
	options: {
		os?: OsFake | null;
		desktop?: boolean;
		plugins?: Parameters<typeof renderShell>[0];
	} = {},
) {
	await renderShell(options.plugins ?? [], {
		desktop: options.desktop ?? true,
		beforeRender: (main) => {
			if (options.os === null) return;
			main.kernelSdk.domains.provide(KernelOs, {
				initialState: {},
				methods: {
					openExternal: () => true,
					showItemInFolder: () => {},
					showLogs: options.os?.showLogs ?? (() => ({ revealed: true })),
					logFilePath: options.os?.logFilePath ?? (() => "/user-data/logs/main.log"),
				},
			});
		},
	});
	window.location.hash = "#/settings/about";
}

function aboutBlocks() {
	return contributor(
		"acme.about",
		{
			"kilo.shell/about-section": [
				{ id: "above", priority: 300 },
				{ id: "below", priority: 100 },
			],
		},
		(sdk) => {
			sdk.extensions.implement(AboutSection, "above", () => <p data-qa-id="block-above">Above</p>);
			sdk.extensions.implement(AboutSection, "below", () => <p data-qa-id="block-below">Below</p>);
		},
	);
}

function supportRow() {
	return contributor("acme.agent", { "kilo.shell/support-row": [{ id: "config" }] }, (sdk) => {
		sdk.extensions.implement(SupportRow, "config", () => (
			<div data-qa-id="contributed-support-row">Kilo config</div>
		));
	});
}

afterEach(() => {
	toast.dismiss();
});

describe("About settings", () => {
	it("opens under its header with contributed blocks around Support, by priority", async () => {
		await openAbout({ plugins: [aboutBlocks()] });

		await expect.element(page.getByTestId("about-settings")).toBeVisible();
		await expect.element(page.getByTestId("settings-section-heading")).toHaveTextContent("About");
		await expect.element(page.getByTestId("about-support")).toBeVisible();

		const order = [...page.getByTestId("about-settings").element().querySelectorAll("[data-qa-id]")]
			.map((element) => element.getAttribute("data-qa-id"))
			.filter((id) => id === "block-above" || id === "about-support" || id === "block-below");
		expect(order).toEqual(["block-above", "about-support", "block-below"]);
	});

	it("is a desktop-only section", async () => {
		await openAbout({ desktop: false });

		await expect.element(page.getByTestId("settings-section-appearance")).toBeVisible();
		await expect.element(page.getByTestId("settings-section-about")).not.toBeInTheDocument();
	});
});

describe("About → Support", () => {
	it("shows the application log's path and reveals it", async () => {
		const showLogs = vi.fn(() => ({ revealed: true }));
		await openAbout({ os: { showLogs } });

		await expect
			.element(
				page.getByTestId("about-logs").getByText("/user-data/logs/main.log", { exact: true }),
			)
			.toBeVisible();
		await page.getByTestId("about-show-log-file").click();

		await vi.waitFor(() => expect(showLogs).toHaveBeenCalledOnce());
	});

	it("shows a placeholder while the log path loads", async () => {
		await openAbout({ os: { logFilePath: () => new Promise(() => {}) } });

		await expect.element(page.getByTestId("about-show-log-file")).toBeVisible();
		expect(
			page.getByTestId("about-logs").element().querySelector('[data-slot="skeleton-text"]'),
		).not.toBeNull();
	});

	it("leaves the log path out when it cannot be read", async () => {
		await openAbout({
			os: {
				logFilePath: () => {
					throw new KernelError("BUSINESS", "No log file");
				},
			},
		});

		await expect.element(page.getByTestId("about-show-log-file")).toBeVisible();
		await vi.waitFor(() =>
			expect(
				page.getByTestId("about-logs").element().querySelector('[data-slot="item-description"]'),
			).toBeNull(),
		);
	});

	it("reports when the log file cannot be revealed", async () => {
		await openAbout({ os: { showLogs: () => ({ revealed: false }) } });

		await page.getByTestId("about-show-log-file").click();

		await expect.element(page.getByText("Could not show the application log file")).toBeVisible();
	});

	it("explains when revealing the log file fails", async () => {
		await openAbout({
			os: {
				showLogs: () => {
					throw new KernelError("UNAVAILABLE", "No file manager");
				},
			},
		});

		await page.getByTestId("about-show-log-file").click();

		await expect.element(page.getByText("No file manager")).toBeVisible();
	});

	it("lists rows other plugins contribute", async () => {
		await openAbout({ plugins: [supportRow()] });

		const support = page.getByTestId("about-support");
		await expect.element(support.getByTestId("about-show-log-file")).toBeVisible();
		await expect.element(support.getByTestId("contributed-support-row")).toBeVisible();
	});

	it("is left out when there is nothing to show", async () => {
		await openAbout({ os: null });

		await expect.element(page.getByTestId("about-settings")).toBeVisible();
		await expect.element(page.getByTestId("about-support")).not.toBeInTheDocument();
	});
});
