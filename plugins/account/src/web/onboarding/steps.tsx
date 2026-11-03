import { useState } from "react";

import { useDomain } from "@kilo-desktop/kernel/web";
import type { OnboardingStepImplementation } from "@kilo-desktop/plugin-shell/contracts";

import { KILO_TERMS_VERSION, Terms } from "../../contracts";
import { useKiloAuth } from "../use-kilo-auth";
import { SignInShowcase, SignInStep } from "./SignInStep";
import { WelcomeStep } from "./WelcomeStep";

/**
 * The welcome splash, and the terms gate: required while the current terms
 * aren't accepted, so it covers the app until they are.
 */
export const welcomeStep: OnboardingStepImplementation = {
	useStep: ({ next }) => {
		const terms = useDomain(Terms);
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
			} finally {
				setBusy(false);
			}
		};

		return {
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
		};
	},
};

export const signInStep: OnboardingStepImplementation = {
	useStep: ({ next }) => {
		const auth = useKiloAuth();
		const signedIn = auth.authenticated === true;
		return {
			title: signedIn ? "Signed in to Kilo" : "Sign in to Kilo",
			subtitle: signedIn
				? "Frontier models, credits, and your team's settings are ready to use."
				: "One account for frontier models, credits, and your team's settings. You can skip this and connect later from Settings → AI Providers.",
			body: <SignInStep auth={auth} onCopy={auth.copyText} />,
			aside: <SignInShowcase />,
			// One way forward: Continue once signed in, otherwise Skip.
			primary: signedIn ? { label: "Continue", onClick: next } : null,
			skippable: !signedIn,
		};
	},
};
