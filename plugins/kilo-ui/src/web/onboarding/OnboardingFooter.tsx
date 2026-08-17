import { ChevronLeftIcon } from "lucide-react";

import { Button } from "@anaconda-agentic-desktop/ui/components/button";

type OnboardingFooterProps = {
	showBack: boolean;
	busy: boolean;
	continueDisabled: boolean;
	continueLabel: string;
	onBack: () => void;
	onContinue: () => void;
	onSkip: () => void;
};

export function OnboardingFooter({
	showBack,
	busy,
	continueDisabled,
	continueLabel,
	onBack,
	onContinue,
	onSkip,
}: OnboardingFooterProps) {
	return (
		<footer className="border-border mt-6 flex flex-none items-center justify-between border-t pt-5">
			<Button
				type="button"
				variant="ghost"
				disabled={busy}
				onClick={onSkip}
				data-qa-id="onboarding-skip"
			>
				Skip
			</Button>
			<div className="flex items-center gap-2">
				{showBack ? (
					<Button
						type="button"
						variant="outline"
						disabled={busy}
						onClick={onBack}
						data-qa-id="onboarding-back"
					>
						<ChevronLeftIcon data-icon="inline-start" />
						Back
					</Button>
				) : null}
				<Button
					type="button"
					disabled={busy || continueDisabled}
					onClick={onContinue}
					data-qa-id="onboarding-continue"
				>
					{continueLabel}
				</Button>
			</div>
		</footer>
	);
}
