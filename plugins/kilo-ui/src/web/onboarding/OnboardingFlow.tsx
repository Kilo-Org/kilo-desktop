import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { type ReactNode, useRef } from "react";

import { Button } from "@kilo-desktop/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@kilo-desktop/ui/components/dialog";
import { cn } from "@kilo-desktop/ui/lib/utils";

import { OnboardingFooter } from "./OnboardingFooter.js";
import { PROGRESS_STEPS, type OnboardingStepId } from "./resolve-onboarding.js";
import { WelcomeStep } from "./WelcomeStep.js";
import { WizardStepIndicator, type WizardStep } from "./WizardStepIndicator.js";

type ProgressStepId = (typeof PROGRESS_STEPS)[number];

const COPY: Record<ProgressStepId, { title: string; subtitle: string }> = {
	"kilo-sign-in": {
		title: "Sign in to Kilo",
		subtitle:
			"One account for frontier models, credits, and your team's settings. You can skip this and connect later from Settings → AI Providers.",
	},
	"work-style": {
		title: "Choose how you want to work",
		subtitle: "Decide how often Kilo checks with you before it edits files or runs commands.",
	},
	workspace: {
		title: "Create a workspace",
		subtitle:
			"Point Kilo at the folders you want the agent to work in. You can add more workspaces anytime.",
	},
	features: {
		title: "You're all set",
		subtitle: "Here's a quick look at what you can do in Kilo.",
	},
};

const STEP_LABELS: Record<ProgressStepId, string> = {
	"kilo-sign-in": "Sign in",
	"work-style": "Work style",
	workspace: "Workspace",
	features: "Features",
};

const toWizardSteps = (ids: readonly ProgressStepId[]): readonly WizardStep<ProgressStepId>[] =>
	ids.map((id) => ({ id, label: STEP_LABELS[id] }));

const EASE = [0.16, 1, 0.3, 1] as const;

const STEP_MOTION = {
	initial: { opacity: 0, y: 16 },
	animate: { opacity: 1, y: 0 },
	exit: { opacity: 0, y: -12, transition: { duration: 0.18 } },
	transition: { duration: 0.4, ease: EASE },
} as const;

/**
 * Full-window onboarding frame. A modal dialog (focus trap, Escape to leave)
 * stretched over the whole window: a draggable title bar with the exit and the
 * animated step canvas. Every step after the welcome splash sits in one
 * borderless card between the progress bars and its actions; sign-in and
 * workspace split it with a showcase `aside`, the feature tour fills it.
 */
export function OnboardingFlow({
	step,
	busy = false,
	continueDisabled = false,
	continueLabel = "Continue",
	showBack = false,
	showSkip = true,
	showContinue = true,
	canJumpTo = () => true,
	aside,
	progressSteps = PROGRESS_STEPS,
	heading,
	termsAccepted = false,
	onTermsAcceptedChange = () => undefined,
	onBack,
	onContinue,
	onSkip,
	onDismiss,
	onJump,
	children,
}: {
	step: OnboardingStepId;
	busy?: boolean;
	continueDisabled?: boolean;
	continueLabel?: string;
	showBack?: boolean;
	showSkip?: boolean;
	showContinue?: boolean;
	canJumpTo?: (step: OnboardingStepId) => boolean;
	/** Showcase panel beside the split-layout steps (hidden on narrow windows). */
	aside?: ReactNode;
	/** Steps shown in the progress bars (the provider drops steps it auto-skips). */
	progressSteps?: readonly ProgressStepId[];
	/** Replaces the step's default title and subtitle (e.g. once signed in). */
	heading?: { title: string; subtitle: string } | undefined;
	/** Terms-of-service checkbox on the welcome step; gates Get started. */
	termsAccepted?: boolean;
	onTermsAcceptedChange?: (accepted: boolean) => void;
	onBack: () => void;
	onContinue: () => void;
	onSkip: () => void;
	/** Escape or "Exit setup": leave onboarding entirely rather than advancing a step. */
	onDismiss: () => void;
	onJump: (step: OnboardingStepId) => void;
	children?: ReactNode;
}) {
	const panel = useRef<HTMLDivElement>(null);

	return (
		<Dialog
			open
			disablePointerDismissal
			onOpenChange={(open) => {
				if (!open && !busy) onDismiss();
			}}
		>
			<DialogContent
				ref={panel}
				initialFocus={panel}
				showCloseButton={false}
				data-qa-id="onboarding-overlay"
				data-step={step}
				overlayClassName="bg-background supports-backdrop-filter:backdrop-blur-none data-open:animate-none!"
				className="top-0 left-0 flex h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none p-0 ring-0 data-open:animate-none! sm:max-w-none"
			>
				<MotionConfig reducedMotion="user">
					<header
						className={cn(
							"drag-region absolute inset-x-0 top-0 z-10 flex h-12 items-center justify-end pr-3 pl-[84px]",
							step !== "welcome" && "bg-background",
						)}
					>
						{/* No way out of the welcome step until the terms are accepted. */}
						{step === "welcome" ? null : (
							<Button
								type="button"
								variant="ghost"
								size="sm"
								disabled={busy}
								onClick={onDismiss}
								data-qa-id="onboarding-exit"
							>
								Exit setup
							</Button>
						)}
					</header>

					<main className="relative min-h-0 flex-1 overflow-y-auto">
						{/* Clips the step's slide offset so it never counts as scrollable
						    overflow (which flashes the scrollbar); real content height still
						    scrolls because this wrapper grows with it. */}
						<div className="flex min-h-full flex-col overflow-clip">
							<AnimatePresence mode="wait" initial={false}>
								{step === "welcome" ? (
									<motion.div key="welcome" className="flex flex-1 flex-col" {...STEP_MOTION}>
										<WelcomeStep
											termsAccepted={termsAccepted}
											onTermsAcceptedChange={onTermsAcceptedChange}
											onContinue={onContinue}
										/>
									</motion.div>
								) : (
									// Top-anchored so the progress bars and card top never move between
									// steps: the offset centres the standard stack (bars, 36rem card,
									// actions ≈ 40.75rem) in the window, and taller steps grow downward.
									<motion.div
										key="wizard"
										className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-center gap-5 px-8 pt-[max(3.5rem,calc((100dvh_-_40.75rem)/2))] pb-8 lg:px-12"
										{...STEP_MOTION}
									>
										<WizardStepIndicator
											steps={toWizardSteps(progressSteps)}
											currentStep={step}
											busy={busy}
											qaPrefix="onboarding"
											showCount={false}
											canSelect={canJumpTo}
											onSelect={onJump}
										/>
										<AnimatePresence mode="wait" initial={false}>
											<motion.div
												key={step}
												data-qa-id="onboarding-card"
												className="bg-muted/50 dark:bg-card w-full overflow-hidden rounded-[28px]"
												{...STEP_MOTION}
											>
												{step === "features" ? (
													<div className="flex flex-col justify-center gap-6 p-6 lg:min-h-[36rem] lg:px-8">
														<StepHeading copy={heading ?? COPY[step]} centered />
														<div data-qa-id="onboarding-step-body">{children}</div>
													</div>
												) : (
													<div className="grid grid-cols-1 lg:min-h-[36rem] lg:grid-cols-2">
														<section className="flex flex-col justify-center gap-6 p-8 lg:px-14 lg:py-12">
															<StepHeading copy={heading ?? COPY[step]} />
															<div data-qa-id="onboarding-step-body">{children}</div>
														</section>
														{aside ? (
															<aside
																aria-hidden="true"
																className="bg-foreground/3 hidden items-center justify-center overflow-hidden p-10 lg:flex"
															>
																<div className="w-full max-w-md">{aside}</div>
															</aside>
														) : null}
													</div>
												)}
											</motion.div>
										</AnimatePresence>
										<OnboardingFooter
											showBack={showBack}
											showSkip={showSkip}
											showContinue={showContinue}
											busy={busy}
											continueDisabled={continueDisabled}
											continueLabel={continueLabel}
											onBack={onBack}
											onContinue={onContinue}
											onSkip={onSkip}
										/>
									</motion.div>
								)}
							</AnimatePresence>
						</div>
					</main>
				</MotionConfig>
			</DialogContent>
		</Dialog>
	);
}

function StepHeading({
	copy,
	centered = false,
}: {
	copy: { title: string; subtitle: string };
	centered?: boolean;
}) {
	return (
		<div className={cn("flex flex-col gap-2", centered && "items-center text-center")}>
			<DialogTitle className="text-2xl font-medium tracking-tight">{copy.title}</DialogTitle>
			<DialogDescription className={cn("max-w-md", centered && "text-balance")}>
				{copy.subtitle}
			</DialogDescription>
		</div>
	);
}
