import { ArrowRightIcon, ChevronLeftIcon } from "lucide-react";

import { Button } from "@kilo-desktop/ui/components/button";

type OnboardingFooterProps = {
	showBack: boolean;
	showSkip: boolean;
	showContinue: boolean;
	busy: boolean;
	continueDisabled: boolean;
	continueLabel: string;
	onBack: () => void;
	onContinue: () => void;
	onSkip: () => void;
};

export function OnboardingFooter({
	showBack,
	showSkip,
	showContinue,
	busy,
	continueDisabled,
	continueLabel,
	onBack,
	onContinue,
	onSkip,
}: OnboardingFooterProps) {
	return (
		<footer className="flex w-full shrink-0 items-center justify-between gap-2">
			<div>
				{showBack ? (
					<Button
						type="button"
						variant="ghost"
						disabled={busy}
						onClick={onBack}
						data-qa-id="onboarding-back"
					>
						<ChevronLeftIcon data-icon="inline-start" />
						Back
					</Button>
				) : null}
			</div>
			<div className="flex items-center gap-2">
				{showSkip ? (
					<Button
						type="button"
						variant="ghost"
						disabled={busy}
						onClick={onSkip}
						data-qa-id="onboarding-skip"
					>
						Skip
					</Button>
				) : null}
				{showContinue ? (
					<Button
						type="button"
						disabled={busy || continueDisabled}
						onClick={onContinue}
						data-qa-id="onboarding-continue"
					>
						{continueLabel}
						<ArrowRightIcon data-icon="inline-end" />
					</Button>
				) : null}
			</div>
		</footer>
	);
}
