import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useRef, type ReactNode } from "react";

import { Button } from "@kilo-desktop/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@kilo-desktop/ui/components/dialog";
import {
	WizardStepIndicator,
	type WizardStep,
} from "@kilo-desktop/ui/components/wizard-step-indicator";
import { cn } from "@kilo-desktop/ui/lib/utils";

import type { OnboardingStepView } from "../../contracts";
import { OnboardingFooter } from "./OnboardingFooter";

const EASE = [0.16, 1, 0.3, 1] as const;

const STEP_MOTION = {
	initial: { opacity: 0, y: 16 },
	animate: { opacity: 1, y: 0 },
	exit: { opacity: 0, y: -12, transition: { duration: 0.18 } },
	transition: { duration: 0.4, ease: EASE },
} as const;

/** The parts of a step's view drawn outside its card: the footer and what busy disables. */
export interface StepChrome {
	readonly skippable: boolean;
	readonly busy: boolean;
	/** `continue` is the default Continue (`next`); null hides the button. */
	readonly primary: { readonly label: string; readonly disabled: boolean } | "continue" | null;
}

export interface OnboardingFrameProps {
	readonly stepKey: string;
	readonly layout: "card" | "splash";
	/** The current step, already rendered (its `StepContent`); it animates in and out with the step. */
	readonly content: ReactNode;
	readonly chrome: StepChrome;
	/** Runs the current step's own primary action. */
	readonly onPrimary: () => void;
	/** Card steps in the progress bar. */
	readonly progress: readonly WizardStep<string>[];
	readonly canJumpTo: (stepKey: string) => boolean;
	readonly dismissible: boolean;
	readonly showBack: boolean;
	readonly onBack: () => void;
	readonly onNext: () => void;
	readonly onJump: (stepKey: string) => void;
	/** Escape or "Exit setup". */
	readonly onDismiss: () => void;
}

/**
 * Full-window onboarding frame: a modal dialog (focus trap) stretched over
 * the window, with a draggable title bar holding "Exit setup" and an animated
 * step canvas. Splash steps fill the canvas; card steps sit in one borderless
 * card between the progress bar and the footer. It stays mounted for the
 * whole flow, so each step's content (keyed by step) fades out and the next
 * slides in.
 */
export function OnboardingFrame({
	stepKey,
	layout,
	content,
	chrome,
	onPrimary,
	progress,
	canJumpTo,
	dismissible,
	showBack,
	onBack,
	onNext,
	onJump,
	onDismiss,
}: OnboardingFrameProps) {
	const panel = useRef<HTMLDivElement>(null);
	const busy = chrome.busy;
	const primary =
		chrome.primary === "continue"
			? { label: "Continue", disabled: false, onClick: onNext }
			: chrome.primary && { ...chrome.primary, onClick: onPrimary };

	return (
		<Dialog
			open
			disablePointerDismissal
			onOpenChange={(open) => {
				if (!open && !busy && dismissible) onDismiss();
			}}
		>
			<DialogContent
				ref={panel}
				initialFocus={panel}
				showCloseButton={false}
				data-qa-id="onboarding-overlay"
				data-step={stepKey}
				overlayClassName="bg-background supports-backdrop-filter:backdrop-blur-none data-open:animate-none!"
				className="top-0 left-0 flex h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none p-0 ring-0 data-open:animate-none! sm:max-w-none"
			>
				<MotionConfig reducedMotion="user">
					<header
						className={cn(
							"drag-region absolute inset-x-0 top-0 z-10 flex h-12 items-center justify-end pr-3 pl-[84px]",
							layout === "card" && "bg-background",
						)}
					>
						{dismissible ? (
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
						) : null}
					</header>

					<main className="relative min-h-0 flex-1 overflow-y-auto">
						{/* Clips the step's slide offset so it never counts as scrollable
						    overflow (which flashes the scrollbar); real content height still
						    scrolls because this wrapper grows with it. */}
						<div className="flex min-h-full flex-col overflow-clip">
							<AnimatePresence mode="wait" initial={false}>
								{layout === "splash" ? (
									<motion.div key={stepKey} className="flex flex-1 flex-col" {...STEP_MOTION}>
										{content}
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
											steps={progress}
											currentStep={stepKey}
											busy={busy}
											qaPrefix="onboarding"
											showCount={false}
											canSelect={canJumpTo}
											onSelect={onJump}
										/>
										<AnimatePresence mode="wait" initial={false}>
											<motion.div
												key={stepKey}
												data-qa-id="onboarding-card"
												className="bg-muted/50 dark:bg-card w-full overflow-hidden rounded-[28px]"
												{...STEP_MOTION}
											>
												{content}
											</motion.div>
										</AnimatePresence>
										<OnboardingFooter
											showBack={showBack}
											showSkip={chrome.skippable}
											showContinue={primary !== null}
											busy={busy}
											continueDisabled={primary?.disabled === true}
											continueLabel={primary?.label ?? ""}
											onBack={onBack}
											onContinue={() => primary?.onClick()}
											onSkip={onNext}
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
	title,
	subtitle,
	centered = false,
}: {
	readonly title: string;
	readonly subtitle: string;
	readonly centered?: boolean;
}) {
	return (
		<div className={cn("flex flex-col gap-2", centered && "items-center text-center")}>
			<DialogTitle className="text-2xl font-medium tracking-tight">{title}</DialogTitle>
			<DialogDescription className={cn("max-w-md", centered && "text-balance")}>
				{subtitle}
			</DialogDescription>
		</div>
	);
}

/**
 * A step's view as drawn inside the frame's canvas: a splash step's body, or
 * a card's heading, body and showcase `aside`. Rendered within the step, so
 * it leaves with the step when the next one comes in.
 */
export function StepContent({
	layout,
	view,
}: {
	readonly layout: "card" | "splash";
	readonly view: OnboardingStepView;
}) {
	if (layout === "splash") return view.body;
	return view.centered ? (
		<div className="flex flex-col justify-center gap-6 p-6 lg:min-h-[36rem] lg:px-8">
			<StepHeading title={view.title ?? ""} subtitle={view.subtitle ?? ""} centered />
			<div data-qa-id="onboarding-step-body">{view.body}</div>
		</div>
	) : (
		<div className={cn("grid grid-cols-1 lg:min-h-[36rem]", view.aside ? "lg:grid-cols-2" : "")}>
			<section className="flex flex-col justify-center gap-6 p-8 lg:px-14 lg:py-12">
				<StepHeading title={view.title ?? ""} subtitle={view.subtitle ?? ""} />
				<div data-qa-id="onboarding-step-body">{view.body}</div>
			</section>
			{view.aside ? (
				<aside
					aria-hidden="true"
					className="bg-foreground/3 hidden items-center justify-center overflow-hidden p-10 lg:flex"
				>
					<div className="w-full max-w-md">{view.aside}</div>
				</aside>
			) : null}
		</div>
	);
}
