import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { ConversationMap, type ConversationMapEntry } from "./conversation-map";

const entries: ConversationMapEntry[] = [
	{ id: "turn-1", title: "Plan the refactor", preview: "Outline the steps first." },
	{ id: "turn-2", title: "Apply the changes", preview: "Edit the three modules." },
	{ id: "turn-3", title: "Run the tests" },
];

function renderMap(onSelect = vi.fn()) {
	const { baseElement } = render(
		<div style={{ height: 300 }}>
			<ConversationMap entries={entries} activeId="turn-3" onSelect={onSelect} />
		</div>,
	);
	return { screen: page.elementLocator(baseElement), onSelect };
}

const tick = (screen: ReturnType<typeof renderMap>["screen"], title: string) =>
	screen.getByRole("button", { name: title });

afterEach(() => cleanup());

describe("ConversationMap", () => {
	it("previews the hovered turn and swaps the preview between ticks", async () => {
		const { screen } = renderMap();

		await userEvent.hover(tick(screen, "Plan the refactor"));
		await expect.element(page.getByText("Outline the steps first.")).toBeVisible();

		await userEvent.hover(tick(screen, "Apply the changes"));
		await expect.element(page.getByText("Edit the three modules.")).toBeVisible();
		expect(page.getByText("Outline the steps first.").query()).toBeNull();
	});

	it("hides the preview when the pointer leaves the rail", async () => {
		const { screen } = renderMap();

		await userEvent.hover(tick(screen, "Plan the refactor"));
		await expect.element(page.getByText("Outline the steps first.")).toBeVisible();
		await userEvent.unhover(screen.getByRole("navigation", { name: "Conversation map" }));

		await expect.element(page.getByText("Outline the steps first.")).not.toBeInTheDocument();
	});

	it("previews the keyboard-focused turn and moves with the arrow keys", async () => {
		const { screen } = renderMap();

		await userEvent.tab();
		await expect.element(tick(screen, "Run the tests")).toHaveFocus();
		await userEvent.keyboard("{ArrowUp}");

		await expect.element(tick(screen, "Apply the changes")).toHaveFocus();
		await expect.element(page.getByText("Edit the three modules.")).toBeVisible();
	});

	it("selects the clicked turn", async () => {
		const { screen, onSelect } = renderMap();

		await tick(screen, "Plan the refactor").click();

		expect(onSelect).toHaveBeenCalledWith("turn-1");
	});
});
