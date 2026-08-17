import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";

import {
	sdkQueryKey,
	useSdk,
	useSdkMutation,
	useSdkQuery,
} from "@anaconda-agentic-desktop/sdk-react";

import type { OnboardingService } from "../../contracts/onboarding/schemas.js";
import type { Workspace, WorkspacesService } from "../../contracts/workspaces/schemas.js";
import { useKiloAuth } from "../account/KiloAuthContext.js";
import { useWorkspacesFeature } from "../workspaces/WorkspacesFeatureContext.js";
import { useWorkspaceForm } from "../workspaces/useWorkspaceForm.js";

import { OnboardingFlow } from "./OnboardingFlow.js";
import { resolveOnboarding, type OnboardingStepId } from "./resolve-onboarding.js";
import { SignInStep } from "./SignInStep.js";
import { WorkspaceStep } from "./WorkspaceStep.js";

/**
 * First-run overlay: Kilo sign-in, then create a workspace. Registered as a
 * kilo-ui provider (priority 5, inside Chat) so it can read Kilo auth and
 * workspace state without crossing plugin boundaries.
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
	const [step, setStep] = useState<OnboardingStepId | null>(null);

	const view = resolveOnboarding({
		state: persisted.data ?? null,
		workspaceCount: workspaces.isLoading ? null : workspaces.workspaces.length,
		workspacesLoading: workspaces.isLoading,
		workspacesUnavailable: workspaces.isUnavailable,
		connectionUnavailable: auth.connectionUnavailable,
	});

	useEffect(() => {
		if (view.status === "visible" && step === null) {
			setStep(view.initialStep);
		}
		if (view.status !== "visible") {
			setStep(null);
		}
	}, [step, view.initialStep, view.status]);

	const createWorkspace = useMutation({
		mutationFn: () => workspacesSdk.client.create({ name: form.name, folders: form.folders }),
		onSuccess: async (saved: Workspace) => {
			const listQueryKey = sdkQueryKey(workspacesSdk, "list");
			queryClient.setQueryData<Workspace[]>(listQueryKey, (current) =>
				current ? [...current, saved] : [saved],
			);
			workspaces.setActiveWorkspaceId(saved.id);
			await queryClient.invalidateQueries({ queryKey: listQueryKey });
			await complete.mutateAsync().catch(() => undefined);
		},
		onError: (reason) => {
			form.setError(reason instanceof Error ? reason.message : "Could not save workspace.");
		},
	});

	const currentStep = step ?? view.initialStep;
	const busy = complete.isPending || skip.isPending || createWorkspace.isPending;

	const onContinue = () => {
		if (currentStep === "kilo-sign-in") {
			setStep("workspace");
			return;
		}
		if (!form.validate()) return;
		createWorkspace.mutate();
	};

	if (view.status !== "visible") {
		return children;
	}

	return (
		<>
			{children}
			<OnboardingFlow
				step={currentStep}
				busy={busy}
				continueDisabled={
					currentStep === "kilo-sign-in" ? auth.authenticated === null : form.folders.length === 0
				}
				continueLabel={
					currentStep === "workspace"
						? createWorkspace.isPending
							? "Creating…"
							: "Create workspace"
						: "Continue"
				}
				onBack={() => setStep("kilo-sign-in")}
				onContinue={onContinue}
				onSkip={() => skip.mutate()}
				onJump={setStep}
			>
				{currentStep === "kilo-sign-in" ? (
					<SignInStep
						auth={auth}
						onCopy={(text) => {
							void onboardingSdk.shell.copyText(text);
						}}
					/>
				) : (
					<WorkspaceStep form={form} />
				)}
			</OnboardingFlow>
		</>
	);
}
