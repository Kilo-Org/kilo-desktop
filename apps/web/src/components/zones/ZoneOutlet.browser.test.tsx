import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { SdkProvider } from "@kilo-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeSdk } from "@kilo-desktop/testing";

import { ZoneOutlet } from "./ZoneOutlet";

afterEach(() => {
	cleanup();
});

function makeSystem() {
	const sdk = createFakeSdk({ featureId: "demo" });
	const system = createFakeFeatureSystem({ sdks: { demo: sdk } });
	return { sdk, system };
}

describe("ZoneOutlet", () => {
	it("renders nothing while the zone is empty", () => {
		const { system } = makeSystem();
		const { container } = render(
			<SdkProvider system={system}>
				<ZoneOutlet zone="status-bar" />
			</SdkProvider>,
		);
		expect(container.querySelector('[data-zone="status-bar"]')).toBeNull();
	});

	it("renders contributions priority-ordered and only for its own zone", async () => {
		const { sdk, system } = makeSystem();
		sdk.contribute("status-bar", {
			id: "low",
			component: () => <span>low priority</span>,
			label: "Low",
			priority: 1,
		});
		sdk.contribute("status-bar", {
			id: "high",
			component: () => <span>high priority</span>,
			label: "High",
			priority: 10,
		});
		sdk.contribute("dashboard", {
			id: "other",
			component: () => <span>other zone</span>,
			label: "Other",
		});

		const { baseElement, container } = render(
			<SdkProvider system={system}>
				<ZoneOutlet zone="status-bar" />
			</SdkProvider>,
		);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText("high priority")).toBeVisible();
		await expect.element(screen.getByText("low priority")).toBeVisible();
		expect(screen.getByText("other zone").query()).toBeNull();

		const outlet = container.querySelector('[data-zone="status-bar"]');
		expect(outlet?.textContent).toBe("high prioritylow priority");
	});

	it("re-renders when contributions register and unregister live", async () => {
		const { sdk, system } = makeSystem();
		const { baseElement, container } = render(
			<SdkProvider system={system}>
				<ZoneOutlet zone="sidebar" />
			</SdkProvider>,
		);
		const screen = page.elementLocator(baseElement);

		const remove = sdk.contribute("sidebar", {
			id: "late",
			component: () => <span>late arrival</span>,
			label: "Late",
		});
		await expect.element(screen.getByText("late arrival")).toBeVisible();

		remove();
		await vi.waitFor(() => {
			expect(container.querySelector('[data-zone="sidebar"]')).toBeNull();
		});
	});

	it("skips non-component contributions with a warning instead of crashing", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			const { sdk, system } = makeSystem();
			sdk.contribute("status-bar", {
				id: "broken",
				component: "not-a-component",
				label: "Broken",
			});
			sdk.contribute("status-bar", {
				id: "ok",
				component: () => <span>still works</span>,
				label: "OK",
			});

			const { baseElement } = render(
				<SdkProvider system={system}>
					<ZoneOutlet zone="status-bar" />
				</SdkProvider>,
			);
			const screen = page.elementLocator(baseElement);

			await expect.element(screen.getByText("still works")).toBeVisible();
			expect(warn).toHaveBeenCalledWith(expect.stringContaining('Skipping contribution "Broken"'));
		} finally {
			warn.mockRestore();
		}
	});
});
