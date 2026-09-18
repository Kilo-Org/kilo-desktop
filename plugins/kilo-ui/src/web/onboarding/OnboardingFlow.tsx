import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@kilo-desktop/ui/components/dialog";
import { type ReactNode, useRef } from "react";

import { OnboardingFooter } from "./OnboardingFooter.js";
import { ONBOARDING_STEPS, type OnboardingStepId } from "./resolve-onboarding.js";
import { WizardStepIndicator, type WizardStep } from "./WizardStepIndicator.js";

const COPY: Record<OnboardingStepId, { title: string; subtitle: string }> = {
	"kilo-sign-in": {
		title: "Connect to Kilo",
		subtitle:
			"Connect your Kilo account for frontier models, credits, and organization settings. You can skip this and connect later from Settings → AI Providers.",
	},
	workspace: {
		title: "Create a workspace",
		subtitle: "Add the folders you want the agent to work in. You can add more workspaces anytime.",
	},
};

const STEP_LABELS: Record<OnboardingStepId, string> = {
	"kilo-sign-in": "Kilo Gateway",
	workspace: "Workspace",
};

const STEPS: readonly WizardStep<OnboardingStepId>[] = ONBOARDING_STEPS.map((id) => ({
	id,
	label: STEP_LABELS[id],
}));

export function OnboardingFlow({
	step,
	busy = false,
	continueDisabled = false,
	continueLabel = "Continue",
	onBack,
	onContinue,
	onSkip,
	onJump,
	children,
}: {
	step: OnboardingStepId;
	busy?: boolean;
	continueDisabled?: boolean;
	continueLabel?: string;
	onBack: () => void;
	onContinue: () => void;
	onSkip: () => void;
	onJump: (step: OnboardingStepId) => void;
	children: ReactNode;
}) {
	const stepIndex = ONBOARDING_STEPS.indexOf(step);
	const copy = COPY[step];
	const panel = useRef<HTMLDivElement>(null);

	return (
		<Dialog
			open
			disablePointerDismissal
			onOpenChange={(open) => {
				if (!open && !busy) onSkip();
			}}
		>
			<DialogContent
				ref={panel}
				initialFocus={panel}
				showCloseButton={false}
				data-qa-id="onboarding-overlay"
				className="flex max-h-[min(960px,calc(100vh-2rem))] min-h-0 flex-col sm:max-w-2xl"
			>
				<WizardStepIndicator
					steps={STEPS}
					currentStep={step}
					busy={busy}
					qaPrefix="onboarding"
					onSelect={onJump}
				/>

				<DialogHeader>
					<DialogTitle className="text-2xl leading-tight font-semibold tracking-tight">
						{copy.title}
					</DialogTitle>
					<DialogDescription className="text-[15px] leading-relaxed">
						{copy.subtitle}
					</DialogDescription>
				</DialogHeader>

				<div className="min-h-0 flex-1 overflow-y-auto" data-qa-id="onboarding-step-body">
					{children}
				</div>

				<OnboardingFooter
					showBack={stepIndex > 0}
					busy={busy}
					continueDisabled={continueDisabled}
					continueLabel={continueLabel}
					onBack={onBack}
					onContinue={onContinue}
					onSkip={onSkip}
				/>
			</DialogContent>
		</Dialog>
	);
}
