import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { ChatAgentSelectionProvider } from "../../agent-selection/ChatAgentSelectionContext.js";
import { KiloAgentSelector } from "./kilo-agent-selector.js";

afterEach(() => {
	cleanup();
});

describe("KiloAgentSelector", () => {
	it("keeps the optimistic menu interactive while the catalog loads behind the scenes", async () => {
		const setAgent = vi.fn();
		const { baseElement } = render(
			<ChatAgentSelectionProvider
				value={{
					agent: "code",
					setAgent,
					catalog: undefined,
					isCatalogPending: true,
					isCatalogError: false,
				}}
			>
				<KiloAgentSelector />
			</ChatAgentSelectionProvider>,
		);
		const screen = page.elementLocator(baseElement);
		const trigger = screen.getByTestId("kilo-agent-selector-trigger");

		await expect.element(trigger).toBeVisible();
		await expect.element(trigger).toHaveAttribute("aria-busy", "true");
		await expect.element(trigger).toBeEnabled();
		await expect.element(trigger).toHaveTextContent("Code");

		await trigger.click();
		await expect.element(screen.getByTestId("kilo-agent-selector-content")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-agent-selector-item-plan")).toBeVisible();

		await screen.getByTestId("kilo-agent-selector-item-plan").click();
		expect(setAgent).toHaveBeenCalled();
		expect(setAgent.mock.calls[0]?.[0]).toBe("plan");
	});
});
