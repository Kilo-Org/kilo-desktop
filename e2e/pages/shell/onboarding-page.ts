import {
	click,
	expectElementToBeEnabled,
	expectElementToBeHidden,
	expectElementToBeVisible,
	expectElementToContainText,
	getLocatorByTestId,
} from "@anaconda/playwright-utils";

import { onboardingData } from "../../testdata/onboarding.js";

/**
 * kilo.shell's first-run onboarding. Packaged e2e skips it unless the app is
 * launched with `SHOW_ONBOARDING_LAUNCH_ENV`, which also leaves kilo.core's
 * terms unaccepted on the fresh profile.
 */
export class OnboardingPage {
	private readonly overlay = () => getLocatorByTestId("onboarding-overlay");
	private readonly welcome = () => getLocatorByTestId("onboarding-welcome");
	private readonly acceptTermsBox = () => getLocatorByTestId("onboarding-accept-terms");
	private readonly getStarted = () => getLocatorByTestId("onboarding-get-started");
	private readonly signedIn = () => getLocatorByTestId("onboarding-signed-in");
	private readonly continueButton = () => getLocatorByTestId("onboarding-continue");
	private readonly workStyleStep = () => getLocatorByTestId("onboarding-work-style-step");
	private readonly workStyle = (style: string) =>
		getLocatorByTestId(`onboarding-work-style-${style}`);
	private readonly workspaceStep = () => getLocatorByTestId("onboarding-workspace-step");
	private readonly skipButton = () => getLocatorByTestId("onboarding-skip");
	private readonly featuresStep = () => getLocatorByTestId("onboarding-features");

	async verifyWelcomeShown(): Promise<void> {
		await expectElementToBeVisible(
			this.overlay(),
			"First-run onboarding should cover the app while the terms are not accepted",
		);
		await expectElementToBeVisible(this.welcome(), "Onboarding should open on the welcome step");
	}

	/** Get started stays disabled until the terms box is checked. */
	async acceptTerms(): Promise<void> {
		await click(this.acceptTermsBox());
		await expectElementToBeEnabled(
			this.getStarted(),
			"Get started should be enabled once the terms are accepted",
		);
		await click(this.getStarted());
		await expectElementToBeHidden(this.welcome(), {
			message: "Accepting the terms should move past the welcome step",
		});
	}

	async verifySignedInAsE2eIdentity(): Promise<void> {
		await expectElementToContainText(this.signedIn(), onboardingData.e2eEmail, {
			message: `The sign-in step should show the e2e build signed in as ${onboardingData.e2eEmail}`,
			timeout: onboardingData.signedInTimeoutMs,
		});
	}

	async continueToNextStep(): Promise<void> {
		await click(this.continueButton());
	}

	async chooseWorkStyle(): Promise<void> {
		await expectElementToBeVisible(this.workStyleStep(), "Onboarding should ask for a work style");
		await click(this.workStyle(onboardingData.workStyle));
		await this.continueToNextStep();
	}

	/** kilo.work-sessions' step, offered while the fresh profile has no workspace. */
	async skipWorkspace(): Promise<void> {
		await expectElementToBeVisible(
			this.workspaceStep(),
			"Onboarding should offer to create a workspace on a profile without one",
		);
		await click(this.skipButton());
	}

	async finishFeatures(): Promise<void> {
		await expectElementToBeVisible(
			this.featuresStep(),
			"Onboarding should end on the features step",
		);
		await this.continueToNextStep();
	}

	async verifyClosed(): Promise<void> {
		await expectElementToBeHidden(this.overlay(), {
			message: "Onboarding should close once its last step is done",
		});
	}
}
