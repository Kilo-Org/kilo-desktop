import { useEffect, useState } from "react";

import { KernelTelemetry, type DomainObjectHandle, type PluginSdk } from "@kilo-desktop/kernel";
import { useDomainObject } from "@kilo-desktop/kernel/web";
import { KiloWorkStyle, type WorkStyle } from "@kilo-desktop/plugin-core/contracts";

import type { OnboardingStepImplementation, OnboardingStepProps } from "../../contracts";
import { WorkStyleShowcase, WorkStyleStep } from "./WorkStyleStep";

const errorText = (reason: unknown) =>
	reason instanceof Error && reason.message ? reason.message : "Could not save your work style.";

async function applyWorkStyle(
	workStyle: DomainObjectHandle<typeof KiloWorkStyle> | null,
	style: WorkStyle,
): Promise<void> {
	if (!workStyle) throw new Error("Kilo isn't connected yet. Try again in a moment.");
	await workStyle.methods.apply({ style });
}

/** Reports the step as origin did: shown (once per window) and each style the person continues with. */
interface WorkStyleTelemetry {
	shown(): void;
	selected(style: WorkStyle): void;
}

function workStyleTelemetry(sdk: PluginSdk): WorkStyleTelemetry {
	let reportedShown = false;
	const track = (event: string, data: Record<string, unknown> = {}) => {
		const telemetry = sdk.domainObjects.get(KernelTelemetry);
		void telemetry?.methods.track({ event, data }).catch(() => undefined);
	};
	return {
		shown() {
			if (reportedShown) return;
			reportedShown = true;
			track("work-style-shown");
		},
		selected: (style) => track("work-style-selected", { style }),
	};
}

/**
 * How much Kilo checks in before acting. Review first writes the preset
 * permission rules to the user's global Kilo config (shared with the CLI and
 * VS Code) through `kilo.core/work-style`, warning first when that replaces
 * rules they wrote; High autonomy writes nothing, or restores what Review
 * first replaced earlier in the session.
 */
export function createWorkStyleStep(sdk: PluginSdk): OnboardingStepImplementation {
	const telemetry = workStyleTelemetry(sdk);
	return { Step: (props) => <WorkStyleOnboardingStep {...props} telemetry={telemetry} /> };
}

function WorkStyleOnboardingStep({
	next,
	children,
	telemetry,
}: OnboardingStepProps & { readonly telemetry: WorkStyleTelemetry }) {
	const workStyle = useDomainObject(KiloWorkStyle);
	const [style, setStyle] = useState<WorkStyle>("autonomous");
	const [conflicts, setConflicts] = useState<readonly string[]>([]);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => telemetry.shown(), [telemetry]);

	useEffect(() => {
		if (!workStyle) return;
		let active = true;
		workStyle.methods
			.conflicts(undefined)
			.then(({ keys }) => active && setConflicts(keys))
			.catch(() => undefined);
		return () => {
			active = false;
		};
	}, [workStyle]);

	const apply = async () => {
		setBusy(true);
		setError(null);
		telemetry.selected(style);
		try {
			await applyWorkStyle(workStyle, style);
			next();
		} catch (reason) {
			setError(errorText(reason));
		}
		setBusy(false);
	};

	return children({
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
				replacesExistingRules={style === "human-in-the-loop" && conflicts.length > 0}
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
	});
}
