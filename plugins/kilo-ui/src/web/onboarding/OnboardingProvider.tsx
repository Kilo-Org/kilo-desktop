import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";

import {
	sdkQueryKey,
	useFeatureFlag,
	useSdk,
	useSdkMutation,
	useSdkQuery,
} from "@kilo-desktop/sdk-react";

import type { OnboardingService } from "../../contracts/onboarding/schemas.js";
import type { Workspace, WorkspacesService } from "../../contracts/workspaces/schemas.js";
import { useKiloAuth } from "../account/KiloAuthContext.js";
import { useChatConnection } from "../chat/connection/ChatConnectionContext.js";
import { createKiloDirectoryClient } from "../chat/runtime/create-kilo-runtime-client.js";
import { useWorkspacesFeature } from "../workspaces/WorkspacesFeatureContext.js";
import { useWorkspaceForm } from "../workspaces/useWorkspaceForm.js";

import {
	applyWorkStyle,
	findConflictingPermissionKeys,
	type WorkStyleClient,
} from "./apply-work-style.js";
import { FeaturesStep } from "./FeaturesStep.js";
import { OnboardingFlow } from "./OnboardingFlow.js";
import {
	FORCE_ONBOARDING_FLAG,
	resolveOnboarding,
	ONBOARDING_STEPS,
	PROGRESS_STEPS,
	type OnboardingStepId,
} from "./resolve-onboarding.js";
import { SignInShowcase, SignInStep } from "./SignInStep.js";
import { useTermsAcceptance } from "./useTermsAcceptance.js";
import type { AppliedWorkStyle, WorkStyle } from "./work-style-presets.js";
import { WorkStyleShowcase, WorkStyleStep } from "./WorkStyleStep.js";
import { WorkspacePreview, WorkspaceStep } from "./WorkspaceStep.js";

const CONTINUE_LABELS: Record<OnboardingStepId, string> = {
	welcome: "Get started",
	"kilo-sign-in": "Continue",
	"work-style": "Continue",
	workspace: "Create workspace",
	features: "Start building",
};

const SIGNED_IN_HEADING = {
	title: "Signed in to Kilo",
	subtitle: "Frontier models, credits, and your team's settings are ready to use.",
};

const NEXT_STEP: Record<OnboardingStepId, OnboardingStepId | null> = {
	welcome: "kilo-sign-in",
	"kilo-sign-in": "work-style",
	"work-style": "workspace",
	workspace: "features",
	features: null,
};

const PREVIOUS_STEP: Record<OnboardingStepId, OnboardingStepId | null> = {
	welcome: null,
	"kilo-sign-in": "welcome",
	"work-style": "kilo-sign-in",
	workspace: "work-style",
	features: "workspace",
};

const WORK_STYLE_INDEX = ONBOARDING_STEPS.indexOf("work-style");

/**
 * First-run overlay: welcome splash → Kilo sign-in → work style → create a
 * workspace → feature overview. Skip advances past the sign-in or workspace
 * step (the work-style step has none: High autonomy is its no-write choice);
 * past the welcome step, Escape leaves onboarding entirely and is persisted as
 * skipped. Reaching the end (or creating the workspace) is persisted as
 * completed, so the wizard never
 * returns. Creating the workspace records completion immediately, but the
 * overlay stays open for the feature slide — once the session opens the
 * wizard, only an explicit close in that session hides it. After creation
 * only the feature slide is reachable, so Back/progress jumps can't create a
 * duplicate workspace.
 *
 * The work-style step (ported from the Kilo VS Code extension) writes the
 * review-first permission block to the user's global Kilo config — shared with
 * the CLI and VS Code — replacing any rules it already has for those keys, and
 * restores the replaced values if the user comes back and switches to High
 * autonomy (only when those keys still hold exactly what was written).
 * Continue advances only once the write succeeds; later steps can't be jumped
 * to until the step is applied.
 *
 * Terms acceptance is a hard gate, separate from the wizard's outcome: while
 * no acceptance of `KILO_TERMS_VERSION` is recorded locally (or the record
 * can't be read), the welcome step covers the app and cannot be dismissed —
 * regardless of a recorded complete/skip or Kilo being unavailable. If the
 * wizard would otherwise stay hidden, accepting closes the overlay instead of
 * replaying it. Get started advances only once the acceptance is persisted;
 * `useTermsAcceptance` also reports it in telemetry and attributes it to each
 * account that signs in afterwards.
 *
 * Existing workspaces do not suppress a first showing, but they skip the
 * workspace step: users who already have one (typically returning users seeing
 * a new onboarding version) go from work style straight to the feature tour,
 * and it drops out of the progress bars. Registered as a kilo-ui
 * provider (priority 5, inside Chat) so it can read Kilo auth without crossing
 * plugin boundaries. The `force-onboarding` flag reopens it each launch until
 * the user finishes or skips it in that session.
 */
export function OnboardingProvider({ children }: { children: ReactNode }) {
	const onboardingSdk = useSdk<OnboardingService>("kilo-ui");
	const workspacesSdk = useSdk<WorkspacesService>("kilo-ui");
	const auth = useKiloAuth();
	const workspaces = useWorkspacesFeature();
	const queryClient = useQueryClient();
	const persisted = useSdkQuery(onboardingSdk, "onboarding.get");
	const complete = useSdkMutation(onboardingSdk, "onboarding.complete", {
		invalidates: ["onboarding.get"],
	});
	const skip = useSdkMutation(onboardingSdk, "onboarding.skip", {
		invalidates: ["onboarding.get"],
	});
	const form = useWorkspaceForm({ shell: workspacesSdk.shell });
	const [chosenStep, setStep] = useState<OnboardingStepId | null>(null);
	const [workspaceCreated, setWorkspaceCreated] = useState(false);
	const [termsAccepted, setTermsAccepted] = useState(false);
	const [termsError, setTermsError] = useState<string | null>(null);
	const terms = useTermsAcceptance(onboardingSdk);
	const forceFlag = useFeatureFlag(FORCE_ONBOARDING_FLAG);
	const [closedThisSession, setClosedThisSession] = useState(false);
	const chat = useChatConnection();
	// High autonomy (Kilo's defaults, writes nothing) is pre-selected.
	const [workStyle, setWorkStyle] = useState<WorkStyle | null>("autonomous");
	const [workStyleApplied, setWorkStyleApplied] = useState<AppliedWorkStyle | null>(null);
	const [workStyleResolved, setWorkStyleResolved] = useState(false);
	const [workStyleError, setWorkStyleError] = useState<string | null>(null);
	const workStyleShown = useRef(false);
	const onboardingShown = useRef(false);

	const view = resolveOnboarding({
		state: persisted.data ?? null,
		connectionUnavailable: auth.connectionUnavailable,
		forced: forceFlag && !closedThisSession,
	});

	// Derived during render (not set from an effect) so the wizard is on screen
	// in the same frame the persisted state resolves.
	const wizardStep =
		chosenStep ?? (view.status === "visible" && !closedThisSession ? view.initialStep : null);
	// Terms are a hard gate, independent of the wizard: no recorded outcome,
	// Escape, or Kilo connection state lets the app through without them.
	const mustAcceptTerms = terms.accepted === false;
	// Re-prompt for the terms alone when the wizard itself would stay hidden
	// (finished or skipped before, or Kilo unavailable).
	const termsOnly = mustAcceptTerms && wizardStep === null;
	const step: OnboardingStepId | null = mustAcceptTerms ? "welcome" : wizardStep;

	const close = () => {
		setClosedThisSession(true);
		setStep(null);
	};

	// Decided from workspaces that existed before this run: one created here
	// must not re-route the steps mid-flow.
	const skipsWorkspace = !workspaceCreated && workspaces.workspaces.length > 0;
	const nextStep = (from: OnboardingStepId): OnboardingStepId | null => {
		const next = NEXT_STEP[from];
		return next === "workspace" && skipsWorkspace ? NEXT_STEP.workspace : next;
	};
	const previousStep = (from: OnboardingStepId): OnboardingStepId | null => {
		const previous = PREVIOUS_STEP[from];
		return previous === "workspace" && skipsWorkspace ? PREVIOUS_STEP.workspace : previous;
	};
	const progressSteps = skipsWorkspace
		? PROGRESS_STEPS.filter((id) => id !== "workspace")
		: PROGRESS_STEPS;

	const kiloClient = (): WorkStyleClient | null =>
		chat.connection
			? (createKiloDirectoryClient(
					chat.connection,
					chat.connection.globalDirectory,
				) as unknown as WorkStyleClient)
			: null;

	const existingRules = useQuery({
		queryKey: ["onboarding", "work-style", "conflicting-rules", chat.connection?.baseUrl],
		queryFn: () => findConflictingPermissionKeys(kiloClient()!),
		enabled: step === "work-style" && chat.connection !== undefined,
		staleTime: 0,
		retry: false,
	});

	const trackOnboarding = (
		event:
			| "Onboarding Shown"
			| "Onboarding Completed"
			| "Onboarding Skipped"
			| "Work Style Onboarding Shown"
			| "Work Style Selected",
		data = {},
	) => {
		void onboardingSdk.telemetry.track({ event, data }).catch(() => undefined);
	};

	useEffect(() => {
		if (step === null || termsOnly || onboardingShown.current) return;
		onboardingShown.current = true;
		trackOnboarding("Onboarding Shown");
	});

	useEffect(() => {
		if (step !== "work-style" || workStyleShown.current) return;
		workStyleShown.current = true;
		trackOnboarding("Work Style Onboarding Shown");
	});

	const applyStyle = useMutation({
		mutationFn: async (style: WorkStyle) => {
			const client = kiloClient();
			if (!client) throw new Error("Kilo isn't connected yet. Try again in a moment.");
			return applyWorkStyle(client, style, workStyleApplied);
		},
		onMutate: (style) => {
			setWorkStyleError(null);
			trackOnboarding("Work Style Selected", { style });
		},
		onSuccess: (result) => {
			setWorkStyleApplied(result.applied);
			setWorkStyleResolved(true);
			setStep(nextStep("work-style"));
		},
		onError: (reason) => {
			setWorkStyleError(
				reason instanceof Error ? reason.message : "Could not save your work style.",
			);
		},
	});

	const acceptTerms = useMutation({
		mutationFn: terms.record,
		onMutate: () => setTermsError(null),
		// The terms query is already refetched here, so the gate has lifted.
		onSuccess: () => {
			if (!termsOnly) setStep(nextStep("welcome"));
		},
		onError: () => setTermsError("Could not save your acceptance. Try again."),
	});

	const createWorkspace = useMutation({
		mutationFn: () =>
			workspacesSdk.client.create({ name: form.name, color: form.color, folders: form.folders }),
		onSuccess: async (saved: Workspace) => {
			const listQueryKey = sdkQueryKey(workspacesSdk, "list");
			queryClient.setQueryData<Workspace[]>(listQueryKey, (current) =>
				current ? [...current, saved] : [saved],
			);
			workspaces.setActiveWorkspaceId(saved.id);
			setWorkspaceCreated(true);
			void workspacesSdk.telemetry
				.track({
					event: "Workspace Created",
					data: { source: "onboarding", folderCount: saved.folders.length },
				})
				.catch(() => undefined);
			trackOnboarding("Onboarding Completed");
			// Persist completion before leaving the step: if the app quits on the
			// features slide, the wizard must not come back and create a second
			// workspace. The step also stays busy ("Creating…") until this settles.
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: listQueryKey }),
				complete.mutateAsync().catch(() => undefined),
			]);
			setStep("features");
		},
		onError: (reason) => {
			form.setError(reason instanceof Error ? reason.message : "Could not save workspace.");
		},
	});

	if (step === null || (auth.connectionUnavailable && !mustAcceptTerms)) {
		// Until we know whether to onboard, cover the app so it doesn't flash
		// before the wizard; the app still mounts underneath. A failed
		// onboarding read resolves to hidden and lifts the cover; the terms
		// record must load before the app is ever uncovered.
		const pending =
			terms.accepted === null ||
			(persisted.isPending && !auth.connectionUnavailable && !closedThisSession);
		return (
			<>
				{children}
				{pending ? (
					<div
						aria-hidden="true"
						data-qa-id="onboarding-pending"
						className="bg-background fixed inset-0 z-50"
					/>
				) : null}
			</>
		);
	}

	const busy =
		skip.isPending || createWorkspace.isPending || applyStyle.isPending || acceptTerms.isPending;
	const signedIn = auth.authenticated === true;

	const finish = () => {
		close();
		if (workspaceCreated) return;
		complete.mutate();
		trackOnboarding("Onboarding Completed");
	};

	const onContinue = () => {
		if (step === "welcome") {
			if (termsAccepted) acceptTerms.mutate();
			return;
		}
		if (step === "work-style") {
			if (workStyle) applyStyle.mutate(workStyle);
			return;
		}
		if (step === "workspace") {
			if (form.validate()) createWorkspace.mutate();
			return;
		}
		const next = nextStep(step);
		if (next) setStep(next);
		else finish();
	};

	const onSkip = () => {
		const next = nextStep(step);
		if (next) setStep(next);
	};

	const canJumpTo = (target: OnboardingStepId) => {
		if (workspaceCreated) return target === "features";
		if (skipsWorkspace && target === "workspace") return false;
		return workStyleResolved || ONBOARDING_STEPS.indexOf(target) <= WORK_STYLE_INDEX;
	};

	const onDismiss = () => {
		// Covers every close request (Escape, any future affordance): the
		// welcome step only opens onto the app through accepting the terms.
		if (step === "welcome") return;
		if (step === "features") {
			finish();
			return;
		}
		close();
		if (workspaceCreated) return;
		skip.mutate();
		trackOnboarding("Onboarding Skipped");
	};

	const previous = workspaceCreated ? null : previousStep(step);

	return (
		<>
			{children}
			<OnboardingFlow
				step={step}
				busy={busy}
				continueDisabled={
					(step === "workspace" && form.folders.length === 0) ||
					(step === "work-style" && workStyle === null)
				}
				continueLabel={
					createWorkspace.isPending
						? "Creating…"
						: applyStyle.isPending
							? "Saving…"
							: workStyleError && step === "work-style"
								? "Retry"
								: CONTINUE_LABELS[step]
				}
				showBack={previous !== null}
				// Sign-in offers exactly one way forward: Continue once signed in,
				// otherwise Skip (both would just advance to the workspace step).
				showSkip={(step === "kilo-sign-in" && !signedIn) || step === "workspace"}
				showContinue={step !== "kilo-sign-in" || signedIn}
				canJumpTo={canJumpTo}
				onBack={() => {
					if (previous) setStep(previous);
				}}
				onContinue={onContinue}
				onSkip={onSkip}
				onDismiss={onDismiss}
				progressSteps={progressSteps}
				termsAccepted={termsAccepted}
				termsError={termsError}
				onTermsAcceptedChange={setTermsAccepted}
				heading={step === "kilo-sign-in" && signedIn ? SIGNED_IN_HEADING : undefined}
				aside={
					step === "kilo-sign-in" ? (
						<SignInShowcase />
					) : step === "work-style" ? (
						<WorkStyleShowcase style={workStyle} />
					) : step === "workspace" ? (
						<WorkspacePreview form={form} />
					) : undefined
				}
				onJump={setStep}
			>
				{step === "kilo-sign-in" ? (
					<SignInStep
						auth={auth}
						onCopy={(text) => {
							void onboardingSdk.shell.copyText(text);
						}}
					/>
				) : step === "work-style" ? (
					<WorkStyleStep
						value={workStyle}
						onValueChange={(style) => {
							setWorkStyle(style);
							setWorkStyleError(null);
						}}
						disabled={applyStyle.isPending}
						replacesExistingRules={
							workStyle === "human-in-the-loop" &&
							(existingRules.data?.length ?? 0) > 0 &&
							workStyleApplied === null
						}
						error={workStyleError}
					/>
				) : step === "workspace" ? (
					<WorkspaceStep form={form} />
				) : step === "features" ? (
					<FeaturesStep />
				) : null}
			</OnboardingFlow>
		</>
	);
}
