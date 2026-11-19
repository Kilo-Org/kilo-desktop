import type { OnboardingStepImplementation } from "../../contracts";
import { FeaturesStep } from "./FeaturesStep";

/** The closing step: a quick look at what the app can do. */
export const featuresStep: OnboardingStepImplementation = {
	Step: ({ next, children }) =>
		children({
			title: "You're all set",
			subtitle: "Here's a quick look at what you can do in Kilo.",
			body: <FeaturesStep />,
			centered: true,
			primary: { label: "Start building", onClick: next },
		}),
};
