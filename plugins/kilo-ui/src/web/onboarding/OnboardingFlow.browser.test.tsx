import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { DEFAULT_WORKSPACE_IDENTITY_COLOR } from "../../contracts/workspaces/schemas.js";
import type { useWorkspaceForm } from "../workspaces/useWorkspaceForm.js";

import { OnboardingFlow } from "./OnboardingFlow.js";
import { WorkspaceStep } from "./WorkspaceStep.js";

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
		await expect.element(screen.getByTestId("onboarding-wordmark")).not.toBeInTheDocument();
		await expect.element(screen.getByRole("heading", { name: "Connect to Kilo" })).toBeVisible();
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

	it("keeps the identity color swatches inside the step body", async () => {
		const form = {
			name: "",
			setName: vi.fn(),
			color: DEFAULT_WORKSPACE_IDENTITY_COLOR,
			setColor: vi.fn(),
			folders: [],
			error: null,
			setError: vi.fn(),
			isDragging: false,
			setIsDragging: vi.fn(),
			canPickDirectories: true,
			chooseFolders: vi.fn(),
			onDrop: vi.fn(),
			removeFolder: vi.fn(),
			makePrimary: vi.fn(),
			validate: vi.fn(),
		} satisfies ReturnType<typeof useWorkspaceForm>;
		const { baseElement } = render(
			<OnboardingFlow
				step="workspace"
				onBack={vi.fn()}
				onContinue={vi.fn()}
				onSkip={vi.fn()}
				onJump={vi.fn()}
			>
				<WorkspaceStep form={form} />
			</OnboardingFlow>,
		);
		const screen = page.elementLocator(baseElement);
		await expect.element(screen.getByRole("group", { name: "Identity color" })).toBeVisible();

		const body = screen.getByTestId("onboarding-step-body").element();
		const swatch = screen
			.getByRole("group", { name: "Identity color" })
			.element()
			.querySelector("span");
		expect(swatch).not.toBeNull();
		const bodyBox = body.getBoundingClientRect();
		const swatchBox = swatch!.getBoundingClientRect();
		expect(swatchBox.left - bodyBox.left).toBeGreaterThanOrEqual(4);
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
