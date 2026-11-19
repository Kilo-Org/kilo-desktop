import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

import type { Contribution, WhenExpression } from "@kilo-desktop/kernel";
import {
	RenderContribution,
	useContextKey,
	useDomainObject,
	useDomainObjectState,
	useExtensions,
	useKernel,
} from "@kilo-desktop/kernel/web";

import {
	ONBOARDING_VERSION,
	Onboarding,
	OnboardingStep,
	type OnboardingState,
	type OnboardingStepImplementation,
	type OnboardingStepView,
} from "../../contracts";
import { OnboardingFrame, StepContent, type StepChrome } from "./OnboardingFrame";

/**
 * Dev override that reopens onboarding every launch
 * (`VITE_FEATURE_FLAG_OVERRIDES=force-onboarding`), once some plugin declares the flag.
 */
const FORCE_ONBOARDING_KEY = "kernel/flag:force-onboarding";

type Step = Contribution<typeof OnboardingStep>;

const selectState = (state: OnboardingState) => state;

function isOffered(
	kernel: ReturnType<typeof useKernel>,
	showWhen: Step["metadata"]["showWhen"],
): boolean {
	return showWhen === undefined || kernel.contextKeys.evaluate(showWhen as WhenExpression);
}

/** The steps this run shows: those offered when onboarding opened (or now, before it opens), plus a required step. */
function offeredSteps(
	kernel: ReturnType<typeof useKernel>,
	implemented: readonly Step[],
	offered: ReadonlySet<string> | null,
	required: Step | undefined,
): readonly Step[] {
	return implemented.filter((step) =>
		offered
			? offered.has(step.key) || step === required
			: isOffered(kernel, step.metadata.showWhen),
	);
}

function finishedCurrentVersion(state: OnboardingState): boolean {
	return state.outcome !== null && (state.version ?? 1) >= ONBOARDING_VERSION;
}

/** The first step whose `required` condition holds, re-evaluated as context keys change. */
function useRequiredStep(steps: readonly Step[]): Step | undefined {
	const kernel = useKernel();
	const subscribe = (onChange: () => void) => kernel.contextKeys.subscribe(onChange);
	const read = () =>
		steps.find(
			(step) =>
				step.metadata.required !== undefined &&
				kernel.contextKeys.evaluate(step.metadata.required as WhenExpression),
		)?.key;
	const key = useSyncExternalStore(subscribe, read, read);
	return steps.find((step) => step.key === key);
}

/**
 * First-run onboarding over the whole window, built from `onboarding-step`
 * contributions in priority order. It shows until the current onboarding
 * version is completed or skipped (desktop only). A required step shows
 * whenever its condition holds, even after onboarding is done, and can't be
 * dismissed; satisfying it advances the tour, or closes the overlay if the
 * tour wouldn't otherwise show. Escape and "Exit setup" record a skip; the
 * last step's action records completion. One frame stays mounted for the
 * whole flow: each step renders its own content inside it (so it animates out
 * as the next comes in) and reports its footer state back here.
 */
export function OnboardingHost() {
	const desktop = useContextKey("kernel/desktop");
	const forced = useContextKey(FORCE_ONBOARDING_KEY) || true; // TEMP: always show onboarding for review
	const onboarding = useDomainObject(Onboarding);
	const state = useDomainObjectState(Onboarding, selectState);
	const kernel = useKernel();
	const contributed = useExtensions(OnboardingStep);
	const implemented = contributed.filter((step) => step.implementation !== undefined);
	const required = useRequiredStep(implemented);
	const [closed, setClosed] = useState(false);
	// Which `showWhen` steps apply is decided once, when onboarding opens.
	const [offered, setOffered] = useState<ReadonlySet<string> | null>(null);
	const [chosen, setChosen] = useState<string | null>(null);
	const [furthest, setFurthest] = useState(0);
	const shown = useRef(false);
	const steps = offeredSteps(kernel, implemented, offered, required);
	// The current step's footer state and primary action, reported by the step
	// as it renders (the frame stays mounted across steps, so steps animate).
	const [chrome, setChrome] = useState<{ stepKey: string; chrome: StepChrome } | null>(null);
	const action = useRef<(() => void) | null>(null);
	const setAction = (run: (() => void) | null) => {
		action.current = run;
	};

	const tourVisible =
		desktop && state !== undefined && !closed && (!finishedCurrentVersion(state) || forced);
	const current =
		required ?? (tourVisible ? (steps.find((step) => step.key === chosen) ?? steps[0]) : undefined);
	const index = current ? steps.indexOf(current) : -1;

	if (index > furthest) setFurthest(index);
	if (offered === null && tourVisible && current) {
		setOffered(new Set(steps.map((step) => step.key)));
	}

	useEffect(() => {
		if (!tourVisible || !current || shown.current) return;
		shown.current = true;
		void onboarding?.methods.markShown(undefined).catch(() => undefined);
	}, [current, onboarding, tourVisible]);

	if (!desktop || !current) return null;

	const close = () => {
		setClosed(true);
		setChosen(null);
	};
	const goTo = (step: Step | undefined) => setChosen(step?.key ?? null);
	const next = () => {
		if (required && current === required && !tourVisible) return;
		const following = steps[index + 1];
		if (following) {
			goTo(following);
			return;
		}
		close();
		void onboarding?.methods.complete(undefined).catch(() => undefined);
	};
	const dismiss = () => {
		if (current === steps.at(-1)) {
			next();
			return;
		}
		close();
		void onboarding?.methods.skip(undefined).catch(() => undefined);
	};
	const previous = steps[index - 1];

	const layout = current.metadata.layout;
	const renderStep = (view: OnboardingStepView) => (
		<>
			<ReportChrome stepKey={current.key} view={view} onChrome={setChrome} onAction={setAction} />
			<StepContent layout={layout} view={view} />
		</>
	);

	return (
		<OnboardingFrame
			stepKey={current.key}
			layout={layout}
			content={
				<RenderContribution
					key={current.key}
					contribution={current}
					select={selectStep}
					props={{ next, children: renderStep }}
				/>
			}
			chrome={chrome?.stepKey === current.key ? chrome.chrome : NO_CHROME}
			onPrimary={() => action.current?.()}
			progress={steps
				.filter((step) => step.metadata.layout === "card")
				.map((step) => ({ id: step.key, label: step.metadata.label }))}
			canJumpTo={(key) => steps.findIndex((step) => step.key === key) <= furthest}
			dismissible={current !== required && current.metadata.layout !== "splash"}
			showBack={previous !== undefined && previous.metadata.layout === "card" && !required}
			onBack={() => goTo(previous)}
			onNext={next}
			onJump={(key) => goTo(steps.find((step) => step.key === key))}
			onDismiss={dismiss}
		/>
	);
}

/** Until a step reports its chrome (before its first paint): nothing to press. */
const NO_CHROME: StepChrome = { skippable: false, busy: false, primary: null };

/**
 * Hands the host a step's footer state as it renders, only when it changes
 * (so reporting never loops), and before paint, so the footer never shows the
 * previous step's buttons. The primary action itself is kept current apart.
 */
function ReportChrome({
	stepKey,
	view,
	onChrome,
	onAction,
}: {
	readonly stepKey: string;
	readonly view: OnboardingStepView;
	readonly onChrome: (chrome: { stepKey: string; chrome: StepChrome }) => void;
	readonly onAction: (run: (() => void) | null) => void;
}) {
	const skippable = view.skippable === true;
	const busy = view.busy === true;
	const label = view.primary === undefined ? null : (view.primary?.label ?? null);
	const disabled = view.primary?.disabled === true;
	const kind = view.primary === undefined ? "continue" : view.primary === null ? "none" : "own";
	useLayoutEffect(() => {
		onChrome({
			stepKey,
			chrome: {
				skippable,
				busy,
				primary:
					kind === "continue"
						? "continue"
						: kind === "none" || label === null
							? null
							: { label, disabled },
			},
		});
	}, [onChrome, stepKey, skippable, busy, kind, label, disabled]);
	const run = view.primary?.onClick ?? null;
	useLayoutEffect(() => {
		onAction(run);
	});
	return null;
}

/** Runs in the step's plugin context, keyed per step so its hooks never mix with another's. */
const selectStep = (step: OnboardingStepImplementation) => step.Step;
