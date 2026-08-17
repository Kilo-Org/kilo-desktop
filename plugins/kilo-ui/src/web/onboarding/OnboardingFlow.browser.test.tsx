import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { OnboardingFlow } from "./OnboardingFlow.js";

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("OnboardingFlow", () => {
	it("renders the Kilo sign-in chrome, progress, and skip", async () => {
		const onSkip = vi.fn();
		const onContinue = vi.fn();
		const onBack = vi.fn();
		const onJump = vi.fn();
		const { baseElement } = render(
			<OnboardingFlow
				step="kilo-sign-in"
				onBack={onBack}
				onContinue={onContinue}
				onSkip={onSkip}
				onJump={onJump}
			>
				<p>Sign-in body</p>
			</OnboardingFlow>,
		);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("onboarding-overlay")).toBeVisible();
		await expect
			.element(screen.getByTestId("onboarding-wordmark"))
			.toHaveTextContent("Welcome to Anaconda");
		await expect.element(screen.getByRole("heading", { name: "Sign in to Kilo" })).toBeVisible();
		await expect
			.element(screen.getByTestId("onboarding-progress-label"))
			.toHaveTextContent("1 of 2");
		await expect.element(screen.getByTestId("onboarding-back")).not.toBeInTheDocument();

		await screen.getByTestId("onboarding-skip").click();
		expect(onSkip).toHaveBeenCalledOnce();

		await screen.getByTestId("onboarding-continue").click();
		expect(onContinue).toHaveBeenCalledOnce();
	});

	it("shows Back on the workspace step and jumps via the progress bars", async () => {
		const onBack = vi.fn();
		const onJump = vi.fn();
		const { baseElement } = render(
			<OnboardingFlow
				step="workspace"
				continueLabel="Create workspace"
				onBack={onBack}
				onContinue={vi.fn()}
				onSkip={vi.fn()}
				onJump={onJump}
			>
				<p>Workspace body</p>
			</OnboardingFlow>,
		);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByRole("heading", { name: "Create a workspace" })).toBeVisible();
		await expect
			.element(screen.getByTestId("onboarding-progress-label"))
			.toHaveTextContent("2 of 2");
		await expect
			.element(screen.getByTestId("onboarding-continue"))
			.toHaveTextContent("Create workspace");

		await screen.getByTestId("onboarding-back").click();
		expect(onBack).toHaveBeenCalledOnce();

		await screen.getByTestId("onboarding-progress-kilo-sign-in").click();
		expect(onJump).toHaveBeenCalledWith("kilo-sign-in");
	});

	it("does not jump via the progress bars while a mutation is in flight", async () => {
		const { baseElement } = render(
			<OnboardingFlow
				step="workspace"
				busy
				onBack={vi.fn()}
				onContinue={vi.fn()}
				onSkip={vi.fn()}
				onJump={vi.fn()}
			>
				<p>Workspace body</p>
			</OnboardingFlow>,
		);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("onboarding-progress-kilo-sign-in")).toBeDisabled();
	});

	it("skips when the dialog is dismissed with Escape", async () => {
		const onSkip = vi.fn();
		const { baseElement } = render(
			<OnboardingFlow
				step="kilo-sign-in"
				onBack={vi.fn()}
				onContinue={vi.fn()}
				onSkip={onSkip}
				onJump={vi.fn()}
			>
				<p>Sign-in body</p>
			</OnboardingFlow>,
		);
		const screen = page.elementLocator(baseElement);
		await expect.element(screen.getByTestId("onboarding-overlay")).toBeVisible();
		await userEvent.keyboard("{Escape}");
		expect(onSkip).toHaveBeenCalledOnce();
	});

	it("does not focus the first progress bar when the dialog opens", async () => {
		const { baseElement } = render(
			<OnboardingFlow
				step="kilo-sign-in"
				onBack={vi.fn()}
				onContinue={vi.fn()}
				onSkip={vi.fn()}
				onJump={vi.fn()}
			>
				<p>Sign-in body</p>
			</OnboardingFlow>,
		);
		const screen = page.elementLocator(baseElement);
		await expect.element(screen.getByTestId("onboarding-overlay")).toBeVisible();
		await expect.element(screen.getByTestId("onboarding-overlay")).toHaveFocus();
		await expect.element(screen.getByTestId("onboarding-progress-kilo-sign-in")).not.toHaveFocus();
	});
});
