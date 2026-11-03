import { useEffect, useState } from "react";

import type { PluginSdk } from "@kilo-desktop/kernel";
import { useDomain } from "@kilo-desktop/kernel/web";
import type { OnboardingStepImplementation } from "@kilo-desktop/plugin-shell/contracts";

import { AgentServer, WorkStyleOnboarding, type ServerConnection } from "../../contracts";
import { createKiloDirectoryClient } from "../providers/kilo-client";
import {
	applyWorkStyle,
	findConflictingPermissionKeys,
	type WorkStyleClient,
} from "./apply-work-style";
import type { AppliedWorkStyle, WorkStyle } from "./work-style-presets";
import { WorkStyleShowcase, WorkStyleStep } from "./WorkStyleStep";

/**
 * This window's Review first write, kept outside the step so a later switch
 * back to High autonomy can restore exactly the values it replaced, even after
 * navigating away from the step and back.
 */
let appliedThisSession: AppliedWorkStyle | null = null;

/** Forgets this window's applied work style (tests). */
export function resetWorkStyleSession(): void {
	appliedThisSession = null;
}

function workStyleClient(connection: ServerConnection): WorkStyleClient {
	return createKiloDirectoryClient(
		connection,
		connection.globalDirectory,
	) as unknown as WorkStyleClient;
}

const errorText = (reason: unknown) =>
	reason instanceof Error && reason.message ? reason.message : "Could not save your work style.";

/**
 * Announces the step on kilo.agent/work-style-onboarding in the main window:
 * that it was shown (once per window) and each style the person continues
 * with. kilo.telemetry reports them as origin's "Work Style Onboarding Shown"
 * and "Work Style Selected".
 */
interface WorkStyleAnnouncer {
	shown(): void;
	selected(style: WorkStyle): void;
}

function announcer(sdk: PluginSdk): WorkStyleAnnouncer {
	if (sdk.context.get("kernel/secondaryWindow")) return { shown() {}, selected() {} };
	const events = sdk.domains.provide(WorkStyleOnboarding, { initialState: {}, methods: {} });
	let announcedShown = false;
	return {
		shown() {
			if (announcedShown) return;
			announcedShown = true;
			events.emit("shown", {});
		},
		selected: (style) => events.emit("selected", { style }),
	};
}

type StepControls = Parameters<OnboardingStepImplementation["useStep"]>[0];
type StepView = ReturnType<OnboardingStepImplementation["useStep"]>;

/**
 * How much Kilo checks in before acting. Review first writes the preset
 * permission rules to the user's global Kilo config (shared with the CLI and
 * VS Code), warning first when that replaces rules they wrote; High autonomy
 * writes nothing, or restores what Review first replaced.
 */
export function createWorkStyleStep(sdk: PluginSdk): OnboardingStepImplementation {
	const announce = announcer(sdk);
	return { useStep: (controls) => useWorkStyleStep(controls, announce) };
}

function useWorkStyleStep({ next }: StepControls, announce: WorkStyleAnnouncer): StepView {
	const server = useDomain(AgentServer);
	const [style, setStyle] = useState<WorkStyle>("autonomous");
	const [conflicts, setConflicts] = useState<readonly string[]>([]);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => announce.shown(), [announce]);

	useEffect(() => {
		if (!server) return;
		let active = true;
		server.methods
			.connect(undefined)
			.then((connection) => findConflictingPermissionKeys(workStyleClient(connection)))
			.then((keys) => active && setConflicts(keys))
			.catch(() => undefined);
		return () => {
			active = false;
		};
	}, [server]);

	const apply = async () => {
		setBusy(true);
		setError(null);
		announce.selected(style);
		try {
			if (!server) throw new Error("Kilo isn't connected yet. Try again in a moment.");
			const connection = await server.methods.connect(undefined);
			const result = await applyWorkStyle(workStyleClient(connection), style, appliedThisSession);
			appliedThisSession = result.applied;
			next();
		} catch (reason) {
			setError(errorText(reason));
		} finally {
			setBusy(false);
		}
	};

	return {
		title: "Choose how you want to work",
		subtitle: "Decide how often Kilo checks with you before it edits files or runs commands.",
		body: (
			<WorkStyleStep
				value={style}
				onValueChange={(next) => {
					setStyle(next);
					setError(null);
				}}
				disabled={busy}
				replacesExistingRules={
					style === "human-in-the-loop" && conflicts.length > 0 && appliedThisSession === null
				}
				error={error}
			/>
		),
		aside: <WorkStyleShowcase style={style} />,
		primary: {
			label: busy ? "Saving…" : error ? "Retry" : "Continue",
			disabled: busy,
			onClick: () => void apply(),
		},
		busy,
	};
}
