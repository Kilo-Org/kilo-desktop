import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import { ComposerContext, type ComposerTokenUsage } from "./composer-context";

const tokens: ComposerTokenUsage = {
	input: 0,
	output: 0,
	reasoning: 0,
	cacheRead: 0,
	cacheWrite: 0,
};

function renderUsage(used: number, total: number) {
	const { baseElement } = render(
		<ComposerContext usage={{ used, total }} tokens={tokens} rail={<span>$0.42</span>} />,
	);
	return page.elementLocator(baseElement).getByTestId("kilo-composer-context-percent");
}

afterEach(() => cleanup());

describe("ComposerContext", () => {
	it("shows the share of the context window in use without opening the popover", async () => {
		await expect.element(renderUsage(68_000, 200_000)).toHaveTextContent("34%");
	});

	it("shows no share while the context window is unknown", async () => {
		await expect.element(renderUsage(68_000, 0)).not.toBeInTheDocument();
	});
});
