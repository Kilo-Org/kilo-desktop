import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, type Locator } from "vitest/browser";

import { CopyButton } from "./copy-button.js";
import { TooltipProvider } from "./tooltip.js";

afterEach(() => {
	vi.useRealTimers();
	cleanup();
});

const tooltipText = () => document.querySelector('[data-slot="tooltip-content"]')?.textContent;

/*
 * Under fake timers, Vitest's locator actions and retrying assertions
 * (`expect.element`, `expect.poll`) advance the fake clock with real time, so
 * a slow runner can run out the confirmation before the test means to. While
 * timers are fake, click with a DOM event and assert synchronously: only the
 * test moves the clock.
 */
const nameOf = (locator: Locator) => locator.element().getAttribute("aria-label");

async function clickNow(locator: Locator): Promise<void> {
	await act(async () => {
		fireEvent.click(locator.element());
	});
}

function renderCopyButton(props: Partial<Parameters<typeof CopyButton>[0]> = {}) {
	const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
	const { baseElement } = render(
		<TooltipProvider>
			<CopyButton value="src/new.ts" writeText={writeText} data-qa-id="copy" {...props} />
		</TooltipProvider>,
	);
	return { writeText, screen: page.elementLocator(baseElement) };
}

describe("CopyButton", () => {
	it("writes its value through the injected writer", async () => {
		const { writeText, screen } = renderCopyButton();

		await screen.getByTestId("copy").click();

		await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith("src/new.ts"));
	});

	it("confirms the copy in its tooltip and name, then reverts after two seconds", async () => {
		const { screen } = renderCopyButton({ label: "Copy path" });
		const button = screen.getByTestId("copy");
		await button.hover();
		await expect.poll(tooltipText).toBe("Copy path");
		await expect.element(button).toHaveAccessibleName("Copy path");

		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		await clickNow(button);

		expect(tooltipText()).toBe("Copied");
		expect(nameOf(button)).toBe("Copied");
		act(() => vi.advanceTimersByTime(1999));
		expect(nameOf(button)).toBe("Copied");
		act(() => vi.advanceTimersByTime(1));
		expect(nameOf(button)).toBe("Copy path");
		expect(tooltipText()).toBe("Copy path");
	});

	it("keeps the confirmation for a full two seconds after a repeat copy", async () => {
		let resolveSecondWrite = () => {};
		const writeText = vi
			.fn<(text: string) => Promise<void>>()
			.mockResolvedValueOnce()
			.mockImplementationOnce(() => new Promise((resolve) => (resolveSecondWrite = resolve)));
		const { screen } = renderCopyButton({ writeText });
		const button = screen.getByTestId("copy");
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

		await clickNow(button);
		expect(nameOf(button)).toBe("Copied");
		act(() => vi.advanceTimersByTime(1500));
		await clickNow(button);
		expect(writeText).toHaveBeenCalledTimes(2);
		await act(async () => resolveSecondWrite());
		act(() => vi.advanceTimersByTime(1999));
		expect(nameOf(button)).toBe("Copied");
		act(() => vi.advanceTimersByTime(1));
		expect(nameOf(button)).toBe("Copy");
	});

	it("reports a failed write and never confirms it", async () => {
		const failure = new Error("clipboard denied");
		const onError = vi.fn();
		const { screen } = renderCopyButton({ writeText: () => Promise.reject(failure), onError });
		const button = screen.getByTestId("copy");

		await button.click();

		await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(failure));
		await expect.element(button).toHaveAccessibleName("Copy");
	});
});
