import { cn } from "@anaconda-agentic-desktop/ui/lib/utils";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@anaconda-agentic-desktop/ui/components/dialog";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@anaconda-agentic-desktop/ui/components/tooltip";
import { type ReactNode, useRef } from "react";

import { OnboardingFooter } from "./OnboardingFooter.js";
import { ONBOARDING_STEPS, type OnboardingStepId } from "./resolve-onboarding.js";

const COPY: Record<OnboardingStepId, { title: string; subtitle: string }> = {
	"kilo-sign-in": {
		title: "Sign in to Kilo",
		subtitle:
			"Connect your Kilo account for frontier models, credits, and organization settings. You can skip this and sign in later from Settings.",
	},
	workspace: {
		title: "Create a workspace",
		subtitle: "Add the folders you want the agent to work in. You can add more workspaces anytime.",
	},
};

const STEP_LABELS: Record<OnboardingStepId, string> = {
	"kilo-sign-in": "Kilo account",
	workspace: "Workspace",
};

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
				<TooltipProvider delay={0}>
					<div className="flex items-center gap-2">
						{ONBOARDING_STEPS.map((id, index) => {
							const isActive = index === stepIndex;
							const isDone = index < stepIndex;
							return (
								<Tooltip key={id}>
									<TooltipTrigger
										render={
											<button
												type="button"
												data-qa-id={`onboarding-progress-${id}`}
												aria-label={`Go to onboarding step ${index + 1}: ${STEP_LABELS[id]}`}
												aria-current={isActive ? "step" : undefined}
												disabled={busy}
												onClick={() => onJump(id)}
												className={cn(
													"relative h-1 rounded-full outline-none transition-all duration-300 before:absolute before:-inset-y-2 before:-inset-x-1 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:pointer-events-none disabled:opacity-50",
													isActive
														? "bg-foreground w-10"
														: isDone
															? "bg-muted-foreground/70 hover:bg-foreground/80 w-6"
															: "bg-muted-foreground/25 hover:bg-muted-foreground/45 w-6",
												)}
											/>
										}
									/>
									<TooltipContent side="top" sideOffset={8}>
										{STEP_LABELS[id]}
									</TooltipContent>
								</Tooltip>
							);
						})}
						<span
							className="text-muted-foreground ml-3 text-xs font-medium"
							data-qa-id="onboarding-progress-label"
						>
							{stepIndex + 1} of {ONBOARDING_STEPS.length}
						</span>
					</div>
				</TooltipProvider>

				<DialogHeader>
					<DialogTitle className="text-2xl leading-tight font-semibold tracking-tight">
						{copy.title}
					</DialogTitle>
					<DialogDescription className="text-[15px] leading-relaxed">
						{copy.subtitle}
					</DialogDescription>
				</DialogHeader>

				<div className="min-h-0 flex-1 overflow-y-auto">{children}</div>

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
