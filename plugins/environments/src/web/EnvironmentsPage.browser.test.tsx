import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import { EnvironmentsPage } from "./EnvironmentsPage";

afterEach(() => {
	cleanup();
});

describe("EnvironmentsPage", () => {
	it("renders the empty state when no providers are registered", async () => {
		const { baseElement } = render(<EnvironmentsPage />);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByRole("heading", { name: "Environments" })).toBeVisible();
		await expect.element(screen.getByText(/no environment providers available/i)).toBeVisible();
	});
});
