import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import { HomeView } from "./HomeView";

afterEach(() => {
	cleanup();
});

describe("HomeView", () => {
	it("shows the centered welcome title and prompt input", async () => {
		const { baseElement } = render(
			<div className="h-[600px]">
				<HomeView />
			</div>,
		);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText("What would you like to build?")).toBeVisible();
		await expect.element(screen.getByRole("textbox", { name: "Message input" })).toBeVisible();
	});

	it("runs the stub chat model when a message is sent", async () => {
		const { baseElement } = render(
			<div className="h-[600px]">
				<HomeView />
			</div>,
		);
		const screen = page.elementLocator(baseElement);
		const input = screen.getByRole("textbox", { name: "Message input" });
		await input.fill("hello");
		await screen.getByRole("button", { name: "Send message" }).click();
		await expect.element(input).toHaveValue("");
	});
});
