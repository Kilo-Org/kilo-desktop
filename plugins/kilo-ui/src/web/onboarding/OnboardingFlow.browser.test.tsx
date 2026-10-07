import type { ReactNode } from "react";
import { cleanup, render as renderView } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { SdkProvider } from "@kilo-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeSdk } from "@kilo-desktop/testing";

import { DEFAULT_WORKSPACE_IDENTITY_COLOR } from "../../contracts/workspaces/schemas.js";
import type { useWorkspaceForm } from "../workspaces/useWorkspaceForm.js";

import { FeaturesStep } from "./FeaturesStep.js";
import { OnboardingFlow } from "./OnboardingFlow.js";
import { WorkspaceStep } from "./WorkspaceStep.js";

function render(children: ReactNode) {
	const sdk = createFakeSdk({ featureId: "kilo-ui" });
	const system = createFakeFeatureSystem({ sdks: { "kilo-ui": sdk } });
	return renderView(children, {
		wrapper: ({ children }) => <SdkProvider system={system}>{children}</SdkProvider>,
	});
}

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("OnboardingFlow", () => {
	it("renders the welcome splash without progress bars", async () => {
		const onContinue = vi.fn();
		const onTermsAcceptedChange = vi.fn();
		const { baseElement, rerender } = render(
			<OnboardingFlow
				step="welcome"
				continueLabel="Get started"
				showSkip={false}
				onTermsAcceptedChange={onTermsAcceptedChange}
				onBack={vi.fn()}
				onContinue={onContinue}
				onSkip={vi.fn()}
				onDismiss={vi.fn()}
				onJump={vi.fn()}
			/>,
		);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("onboarding-welcome")).toBeVisible();
		await expect.element(screen.getByRole("heading", { name: "Welcome to Kilo" })).toBeVisible();
		await expect.element(screen.getByTestId("onboarding-progress-label")).not.toBeInTheDocument();
		await expect.element(screen.getByTestId("onboarding-back")).not.toBeInTheDocument();
		await expect.element(screen.getByTestId("onboarding-skip")).not.toBeInTheDocument();
		await expect.element(screen.getByTestId("onboarding-exit")).not.toBeInTheDocument();

		await expect.element(screen.getByTestId("onboarding-get-started")).toBeDisabled();
		await screen.getByTestId("onboarding-accept-terms").click();
		expect(onTermsAcceptedChange).toHaveBeenCalledWith(true);

		rerender(
			<OnboardingFlow
				step="welcome"
				showSkip={false}
				termsAccepted
				onTermsAcceptedChange={onTermsAcceptedChange}
				onBack={vi.fn()}
				onContinue={onContinue}
				onSkip={vi.fn()}
				onDismiss={vi.fn()}
				onJump={vi.fn()}
			/>,
		);
		await screen.getByTestId("onboarding-get-started").click();
		expect(onContinue).toHaveBeenCalledOnce();
	});

	it("shows the Kilo logo over the dot grid on the welcome splash", async () => {
		const { baseElement } = render(
			<OnboardingFlow
				step="welcome"
				onBack={vi.fn()}
				onContinue={vi.fn()}
				onSkip={vi.fn()}
				onDismiss={vi.fn()}
				onJump={vi.fn()}
			/>,
		);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("kilo-welcome-logo")).toBeInTheDocument();
		await expect.element(screen.getByTestId("onboarding-dot-grid")).toBeInTheDocument();
	});

	it("leaves onboarding from the Exit setup button", async () => {
		const onDismiss = vi.fn();
		const { baseElement } = render(
			<OnboardingFlow
				step="workspace"
				onBack={vi.fn()}
				onContinue={vi.fn()}
				onSkip={vi.fn()}
				onDismiss={onDismiss}
				onJump={vi.fn()}
			>
				<p>Workspace body</p>
			</OnboardingFlow>,
		);
		const screen = page.elementLocator(baseElement);

		await screen.getByTestId("onboarding-exit").click();
		expect(onDismiss).toHaveBeenCalledOnce();
	});

	it("renders the Kilo sign-in chrome, progress, and skip", async () => {
		const onSkip = vi.fn();
		const onContinue = vi.fn();
		const onBack = vi.fn();
		const { baseElement } = render(
			<OnboardingFlow
				step="kilo-sign-in"
				showBack
				onBack={onBack}
				onContinue={onContinue}
				onSkip={onSkip}
				onDismiss={vi.fn()}
				onJump={vi.fn()}
			>
				<p>Sign-in body</p>
			</OnboardingFlow>,
		);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("onboarding-overlay")).toBeVisible();
		await expect.element(screen.getByRole("heading", { name: "Sign in to Kilo" })).toBeVisible();
		await expect
			.element(screen.getByTestId("onboarding-progress-label"))
			.toHaveTextContent("Step 1 of 4");

		await screen.getByTestId("onboarding-skip").click();
		expect(onSkip).toHaveBeenCalledOnce();

		await screen.getByTestId("onboarding-continue").click();
		expect(onContinue).toHaveBeenCalledOnce();

		await screen.getByTestId("onboarding-back").click();
		expect(onBack).toHaveBeenCalledOnce();
	});

	it("hides Continue when the step only offers Skip", async () => {
		const { baseElement } = render(
			<OnboardingFlow
				step="kilo-sign-in"
				showContinue={false}
				onBack={vi.fn()}
				onContinue={vi.fn()}
				onSkip={vi.fn()}
				onDismiss={vi.fn()}
				onJump={vi.fn()}
			>
				<p>Sign-in body</p>
			</OnboardingFlow>,
		);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("onboarding-skip")).toBeVisible();
		await expect.element(screen.getByTestId("onboarding-continue")).not.toBeInTheDocument();
	});

	it("shows Back on the workspace step and jumps via the progress bars", async () => {
		const onBack = vi.fn();
		const onJump = vi.fn();
		const { baseElement } = render(
			<OnboardingFlow
				step="workspace"
				showBack
				continueLabel="Create workspace"
				canJumpTo={(step) => step !== "features"}
				onBack={onBack}
				onContinue={vi.fn()}
				onSkip={vi.fn()}
				onDismiss={vi.fn()}
				onJump={onJump}
			>
				<p>Workspace body</p>
			</OnboardingFlow>,
		);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByRole("heading", { name: "Create a workspace" })).toBeVisible();
		await expect
			.element(screen.getByTestId("onboarding-progress-label"))
			.toHaveTextContent("Step 3 of 4");
		await expect
			.element(screen.getByTestId("onboarding-continue"))
			.toHaveTextContent("Create workspace");
		await expect.element(screen.getByTestId("onboarding-progress-features")).toBeDisabled();

		await screen.getByTestId("onboarding-back").click();
		expect(onBack).toHaveBeenCalledOnce();

		await screen.getByTestId("onboarding-progress-kilo-sign-in").click();
		expect(onJump).toHaveBeenCalledWith("kilo-sign-in");
	});

	it("renders the feature bento without Skip or Back", async () => {
		const { baseElement } = render(
			<OnboardingFlow
				step="features"
				showSkip={false}
				continueLabel="Start building"
				onBack={vi.fn()}
				onContinue={vi.fn()}
				onSkip={vi.fn()}
				onDismiss={vi.fn()}
				onJump={vi.fn()}
			>
				<FeaturesStep />
			</OnboardingFlow>,
		);
		const screen = page.elementLocator(baseElement);

		await expect
			.element(screen.getByTestId("onboarding-progress-label"))
			.toHaveTextContent("Step 4 of 4");
		for (const title of [
			"Use any model from any provider",
			"Customizable chat layouts",
			"Interactive Python notebooks",
			"Local models",
		]) {
			await expect.element(screen.getByRole("heading", { name: title })).toBeVisible();
		}
		await expect.element(screen.getByTestId("onboarding-skip")).not.toBeInTheDocument();
		await expect.element(screen.getByTestId("onboarding-back")).not.toBeInTheDocument();
	});

	it("does not jump via the progress bars while a mutation is in flight", async () => {
		const { baseElement } = render(
			<OnboardingFlow
				step="workspace"
				busy
				onBack={vi.fn()}
				onContinue={vi.fn()}
				onSkip={vi.fn()}
				onDismiss={vi.fn()}
				onJump={vi.fn()}
			>
				<p>Workspace body</p>
			</OnboardingFlow>,
		);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("onboarding-progress-kilo-sign-in")).toBeDisabled();
	});

	it("dismisses (rather than skipping a step) when Escape is pressed", async () => {
		const onSkip = vi.fn();
		const onDismiss = vi.fn();
		const { baseElement } = render(
			<OnboardingFlow
				step="kilo-sign-in"
				onBack={vi.fn()}
				onContinue={vi.fn()}
				onSkip={onSkip}
				onDismiss={onDismiss}
				onJump={vi.fn()}
			>
				<p>Sign-in body</p>
			</OnboardingFlow>,
		);
		const screen = page.elementLocator(baseElement);
		await expect.element(screen.getByTestId("onboarding-overlay")).toBeVisible();
		await userEvent.keyboard("{Escape}");
		expect(onDismiss).toHaveBeenCalledOnce();
		expect(onSkip).not.toHaveBeenCalled();
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
				onDismiss={vi.fn()}
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
				onDismiss={vi.fn()}
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
