import { useEffect, useRef, useState, useSyncExternalStore } from "react";

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
import { OnboardingFrame } from "./OnboardingFrame";

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
 * last step's action records completion.
 */
export function OnboardingHost() {
	const desktop = useContextKey("kernel/desktop");
	const forced = useContextKey(FORCE_ONBOARDING_KEY);
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

	const renderFrame = (view: OnboardingStepView) => (
		<OnboardingFrame
			stepKey={current.key}
			layout={current.metadata.layout}
			view={view}
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

	return (
		<RenderContribution
			key={current.key}
			contribution={current}
			select={selectStep}
			props={{ next, children: renderFrame }}
		/>
	);
}

/** Runs in the step's plugin context, keyed per step so its hooks never mix with another's. */
const selectStep = (step: OnboardingStepImplementation) => step.Step;
