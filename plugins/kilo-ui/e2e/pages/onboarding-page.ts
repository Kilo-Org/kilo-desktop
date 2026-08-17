import { expectElementToBeHidden, getLocatorByTestId } from "@anaconda/playwright-utils";

/**
 * First-run onboarding overlay. Packaged e2e sets ANACONDA_SKIP_ONBOARDING so
 * the shared worker profile is not blocked; this page object asserts that.
 */
export class OnboardingPage {
	private readonly overlay = () => getLocatorByTestId("onboarding-overlay");

	async verifyHidden(): Promise<void> {
		await expectElementToBeHidden(
			this.overlay(),
			"Onboarding overlay should not block packaged e2e profiles",
		);
	}
}
