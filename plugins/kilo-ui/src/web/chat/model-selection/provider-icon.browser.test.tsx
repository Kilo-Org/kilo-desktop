import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import { ProviderIcon } from "./provider-icon.js";

afterEach(cleanup);

describe("ProviderIcon", () => {
	it("renders registered mono and color icons with the requested accessibility", async () => {
		const { baseElement } = render(
			<>
				<ProviderIcon provider="anthropic" title="Anthropic provider" />
				<ProviderIcon provider="openrouter" variant="color" size={24} className="brand-icon" />
				<ProviderIcon provider="anthropic" variant="color" />
			</>,
		);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByRole("img", { name: "Anthropic provider" })).toBeVisible();
		expect(baseElement.querySelectorAll("svg")).toHaveLength(3);
		expect(baseElement.querySelector(".brand-icon")).not.toBeNull();
		expect(baseElement.querySelectorAll('[aria-hidden="true"]')).toHaveLength(2);
	});

	it("renders custom and initial-based fallbacks for unknown providers", async () => {
		const { baseElement } = render(
			<>
				<ProviderIcon
					provider="custom"
					fallback={<span data-qa-id="custom-provider-icon">Custom</span>}
				/>
				<ProviderIcon provider="acme" fallbackLabel="Acme Models" title="Acme provider" />
				<ProviderIcon provider="solo" fallbackLabel="solo" />
				<ProviderIcon provider="blank" fallbackLabel="   " />
				<ProviderIcon provider="unknown-provider" />
			</>,
		);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("custom-provider-icon")).toHaveTextContent("Custom");
		await expect
			.element(screen.getByRole("img", { name: "Acme provider" }))
			.toHaveTextContent("AM");
		await expect.element(screen.getByText("SO", { exact: true })).toBeVisible();
		await expect.element(screen.getByText("?", { exact: true })).toBeVisible();
		await expect.element(screen.getByText("UN", { exact: true })).toBeVisible();
	});

	it("renders the server icon used on Local provider settings", async () => {
		const { baseElement } = render(<ProviderIcon provider="anaconda-local" title="Local" />);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByRole("img", { name: "Local" })).toBeVisible();
		expect(baseElement.querySelector(".lucide-server")).not.toBeNull();
	});
});
