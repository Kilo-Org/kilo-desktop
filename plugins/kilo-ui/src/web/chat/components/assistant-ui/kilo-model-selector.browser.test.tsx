import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import { ChatModelSelectionProvider } from "../../model-selection/ChatModelSelectionContext.js";
import { KiloModelSelector } from "./kilo-model-selector.js";

afterEach(() => {
	cleanup();
});

describe("KiloModelSelector", () => {
	it("shows the stored display name and effort on the trigger while the catalog is pending", async () => {
		const { baseElement } = render(
			<ChatModelSelectionProvider
				value={{
					model: { providerID: "anthropic", modelID: "claude-sonnet" },
					setModel: () => undefined,
					effort: "high",
					setEffort: () => undefined,
					name: "Claude Sonnet",
					efforts: [
						{ id: "low", name: "Low" },
						{ id: "medium", name: "Med" },
						{ id: "high", name: "High" },
					],
					catalog: undefined,
					isCatalogPending: true,
					isCatalogError: false,
				}}
			>
				<KiloModelSelector />
			</ChatModelSelectionProvider>,
		);
		const screen = page.elementLocator(baseElement);
		const trigger = screen.getByTestId("kilo-model-selector-trigger");

		await expect.element(trigger).toBeVisible();
		await expect.element(trigger).toHaveAttribute("aria-busy", "true");
		await expect.element(trigger).toBeEnabled();
		await expect.element(trigger).toHaveAttribute("aria-label", "Select model");
		await expect.element(screen.getByText("Claude Sonnet")).toBeVisible();
		await expect.element(screen.getByText("High")).toBeVisible();

		await trigger.click();
		await expect.element(screen.getByTestId("kilo-model-selector-content")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-model-selector-loading")).toBeVisible();
	});

	it("falls back to a loading placeholder on the trigger when nothing is stored yet", async () => {
		const { baseElement } = render(
			<ChatModelSelectionProvider
				value={{
					model: undefined,
					setModel: () => undefined,
					effort: undefined,
					setEffort: () => undefined,
					name: undefined,
					efforts: undefined,
					catalog: undefined,
					isCatalogPending: true,
					isCatalogError: false,
				}}
			>
				<KiloModelSelector />
			</ChatModelSelectionProvider>,
		);
		const screen = page.elementLocator(baseElement);
		const trigger = screen.getByTestId("kilo-model-selector-trigger");

		await expect.element(trigger).toBeVisible();
		await expect.element(trigger).toBeEnabled();
		await expect.element(trigger).toHaveAttribute("aria-label", "Loading models");
		await expect.element(screen.getByText("Loading models…")).toBeInTheDocument();

		await trigger.click();
		await expect.element(screen.getByTestId("kilo-model-selector-loading")).toBeVisible();
	});
});
