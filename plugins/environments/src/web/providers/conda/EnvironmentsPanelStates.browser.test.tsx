import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { EnvironmentsErrorState, EnvironmentsStartingState } from "./EnvironmentsPanelStates";

afterEach(() => {
	cleanup();
});

describe("EnvironmentsStartingState", () => {
	it("frames the backend warm-up as 'starting', with no retry button inside the startup window", async () => {
		const { baseElement } = render(
			<EnvironmentsStartingState startedAt={Date.now()} timeoutMs={60_000} onRetry={() => {}} />,
		);
		const screen = page.elementLocator(baseElement);
		await expect.element(screen.getByTestId("environments-conda-starting")).toBeVisible();
		await expect.element(screen.getByText(/starting the conda backend/i)).toBeVisible();
		expect(screen.getByTestId("environments-conda-starting-retry").elements()).toHaveLength(0);
	});

	it("reveals a manual retry once the startup window elapses", async () => {
		const onRetry = vi.fn();
		// startedAt already past the (tiny) timeout → button appears without waiting.
		const { baseElement } = render(
			<EnvironmentsStartingState startedAt={Date.now() - 1_000} timeoutMs={10} onRetry={onRetry} />,
		);
		const screen = page.elementLocator(baseElement);
		const retry = screen.getByTestId("environments-conda-starting-retry");
		await expect.element(retry).toBeVisible();
		await retry.click();
		expect(onRetry).toHaveBeenCalledOnce();
	});

	it("flips from spinner-only to retry when the timeout fires while mounted", async () => {
		const { baseElement } = render(
			<EnvironmentsStartingState startedAt={Date.now()} timeoutMs={100} onRetry={() => {}} />,
		);
		const screen = page.elementLocator(baseElement);
		// Not shown at first…
		expect(screen.getByTestId("environments-conda-starting-retry").elements()).toHaveLength(0);
		// …then appears after the window elapses.
		await expect.element(screen.getByTestId("environments-conda-starting-retry")).toBeVisible();
	});
});

describe("EnvironmentsErrorState", () => {
	it("shows friendly copy, hides raw KernelError internals, and retries on click", async () => {
		const onRetry = vi.fn();
		const { baseElement } = render(
			<EnvironmentsErrorState
				error={new Error("SOLVE_FAILED: found conflicts between numpy and pandas")}
				onRetry={onRetry}
			/>,
		);
		const screen = page.elementLocator(baseElement);

		const state = screen.getByTestId("environments-conda-error");
		await expect.element(state).toBeVisible();
		await expect.element(state).not.toHaveTextContent("SOLVE_FAILED");
		await expect.element(screen.getByText(/could not load environments/i)).toBeVisible();

		await screen.getByTestId("environments-conda-error-retry").click();
		expect(onRetry).toHaveBeenCalledOnce();
	});

	it("falls back to generic copy for errors outside the plugin convention", async () => {
		const { baseElement } = render(
			<EnvironmentsErrorState error={new Error("kaboom")} onRetry={() => {}} />,
		);
		const screen = page.elementLocator(baseElement);
		await expect.element(screen.getByText(/something went wrong/i)).toBeVisible();
	});
});
