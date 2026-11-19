import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import { SignInShowcase } from "./SignInStep";

afterEach(cleanup);

describe("SignInShowcase", () => {
	it("starts on one model per lab", async () => {
		const { baseElement, container } = render(<SignInShowcase />);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText("500+ models from every major lab")).toBeVisible();
		const names = [...container.querySelectorAll('[data-qa-id="showcase-model-name"]')];
		expect(names.map((name) => name.textContent)).toEqual([
			"Claude",
			"GPT",
			"Gemini",
			"Grok",
			"Mistral",
			"DeepSeek",
		]);
	});
});
