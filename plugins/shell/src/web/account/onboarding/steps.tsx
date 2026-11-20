import { useState } from "react";

import { useDomainObject } from "@kilo-desktop/kernel/web";
import { KILO_TERMS_VERSION, KiloTerms } from "@kilo-desktop/plugin-core/contracts";

import type { OnboardingStepImplementation, OnboardingStepProps } from "../../../contracts";
import { useKiloAccount } from "../use-kilo-account";
import { SignInShowcase, SignInStep } from "./SignInStep";
import { WelcomeStep } from "./WelcomeStep";

/**
 * The welcome splash, and the terms gate: required while the current terms
 * aren't accepted, so it covers the app until they are.
 */
export const welcomeStep: OnboardingStepImplementation = { Step: WelcomeOnboardingStep };

function WelcomeOnboardingStep({ next, children }: OnboardingStepProps) {
	const terms = useDomainObject(KiloTerms);
	const [checked, setChecked] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const accept = async () => {
		if (!terms) return;
		setBusy(true);
		setError(null);
		try {
			await terms.methods.accept({ version: KILO_TERMS_VERSION });
			next();
		} catch {
			setError("Could not save your acceptance. Try again.");
		}
		setBusy(false);
	};

	return children({
		primary: null,
		busy,
		body: (
			<WelcomeStep
				termsAccepted={checked}
				busy={busy}
				error={error}
				onTermsAcceptedChange={setChecked}
				onContinue={() => void accept()}
			/>
		),
	});
}

export const signInStep: OnboardingStepImplementation = { Step: SignInOnboardingStep };

function SignInOnboardingStep({ next, children }: OnboardingStepProps) {
	const auth = useKiloAccount();
	const signedIn = auth.signedIn === true;
	return children({
		title: signedIn ? "Signed in to Kilo" : "Sign in to Kilo",
		subtitle: signedIn
			? "Frontier models, credits, and your team's settings are ready to use."
			: "One account for frontier models, credits, and your team's settings. You can skip this and connect later from Settings → AI Providers.",
		body: <SignInStep auth={auth} onCopy={auth.copyText} />,
		aside: <SignInShowcase />,
		// One way forward: Continue once signed in, otherwise Skip.
		primary: signedIn ? { label: "Continue", onClick: next } : null,
		skippable: !signedIn,
	});
}
