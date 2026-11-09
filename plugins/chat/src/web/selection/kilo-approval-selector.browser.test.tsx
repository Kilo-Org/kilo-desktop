import { describe, expect, it } from "vitest";

import { AutoApprove } from "../../contracts";
import { renderInKernel } from "../../test/kernel-harness";
import { ComposerActionView } from "../composer/composer-actions";
import { approvalAction } from "./kilo-approval-selector";

const CONTEXT = {
	sessionId: "wses_1",
	chatId: null,
	directory: null,
	workspaceId: null,
	workspaceFolders: [],
};

async function renderSelector(mode: "manual" | "auto") {
	const host = await renderInKernel(
		<ComposerActionView
			id="approval"
			title="Approval mode"
			implementation={approvalAction}
			context={CONTEXT}
		/>,
	);
	const autoApprove = host.main.kernelSdk.domains.get(AutoApprove)!;
	await autoApprove.methods.setMode({ mode });
	return { screen: host.screen, autoApprove };
}

describe("the approval selector", () => {
	it("shows Manual and switches to automatic approval from the menu", async () => {
		const { screen, autoApprove } = await renderSelector("manual");
		const trigger = screen.getByTestId("kilo-approval-selector-trigger");
		await expect.element(trigger).toHaveTextContent("Manual");

		await trigger.click();
		await expect
			.element(screen.getByTestId("kilo-approval-selector-item-manual"))
			.toHaveTextContent("Manually approve");
		await screen.getByTestId("kilo-approval-selector-item-auto").click();

		await expect.poll(() => autoApprove.getState().mode).toBe("auto");
		await expect.element(trigger).toHaveTextContent("Auto");
		await expect
			.element(screen.getByTestId("kilo-approval-selector-content"))
			.not.toBeInTheDocument();
	});

	it("shows Auto and switches back to manual approval", async () => {
		const { screen, autoApprove } = await renderSelector("auto");
		const trigger = screen.getByTestId("kilo-approval-selector-trigger");
		await expect.element(trigger).toHaveTextContent("Auto");

		await trigger.click();
		await expect
			.element(screen.getByTestId("kilo-approval-selector-item-auto"))
			.toHaveTextContent("Automatically approve");
		await screen.getByTestId("kilo-approval-selector-item-manual").click();

		await expect.poll(() => autoApprove.getState().mode).toBe("manual");
	});

	it("shows the full option labels instead of truncating them", async () => {
		const { screen } = await renderSelector("auto");
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
