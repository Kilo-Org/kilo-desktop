import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { ChatAutoApproveProvider } from "../../auto-approve/ChatAutoApproveContext.js";
import { KiloApprovalSelector } from "./kilo-approval-selector.js";

afterEach(cleanup);

function renderSelector(enabled: boolean, setEnabled = vi.fn()) {
	const { baseElement, rerender } = render(
		<ChatAutoApproveProvider value={{ enabled, setEnabled }}>
			<KiloApprovalSelector />
		</ChatAutoApproveProvider>,
	);
	return { screen: page.elementLocator(baseElement), rerender, setEnabled };
}

describe("KiloApprovalSelector", () => {
	it("shows Manual and switches to automatic approval from the menu", async () => {
		const { screen, setEnabled } = renderSelector(false);
		const trigger = screen.getByTestId("kilo-approval-selector-trigger");
		await expect.element(trigger).toHaveTextContent("Manual");

		await trigger.click();
		await expect
			.element(screen.getByTestId("kilo-approval-selector-item-manual"))
			.toHaveTextContent("Manually approve");
		await screen.getByTestId("kilo-approval-selector-item-auto").click();

		expect(setEnabled).toHaveBeenCalledExactlyOnceWith(true);
		await expect
			.element(screen.getByTestId("kilo-approval-selector-content"))
			.not.toBeInTheDocument();
	});

	it("shows Auto and switches back to manual approval", async () => {
		const { screen, setEnabled } = renderSelector(true);
		const trigger = screen.getByTestId("kilo-approval-selector-trigger");
		await expect.element(trigger).toHaveTextContent("Auto");

		await trigger.click();
		await expect
			.element(screen.getByTestId("kilo-approval-selector-item-auto"))
			.toHaveTextContent("Automatically approve");
		await screen.getByTestId("kilo-approval-selector-item-manual").click();

		expect(setEnabled).toHaveBeenCalledExactlyOnceWith(false);
	});

	it("shows the full option labels instead of truncating them", async () => {
		const { screen } = renderSelector(true);
		await screen.getByTestId("kilo-approval-selector-trigger").click();
		const label = screen
			.getByTestId("kilo-approval-selector-item-auto")
			.getByText("Automatically approve")
			.element() as HTMLElement;

		await expect.element(label).toBeVisible();
		expect(label.scrollWidth).toBeLessThanOrEqual(label.clientWidth);
		const content = screen.getByTestId("kilo-approval-selector-content").element() as HTMLElement;
		expect(content.scrollWidth).toBeLessThanOrEqual(content.clientWidth);
	});
});
