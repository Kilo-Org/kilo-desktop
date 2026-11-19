import { useEffect, useState } from "react";

import { Button } from "@kilo-desktop/ui/components/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@kilo-desktop/ui/components/empty";
import { Spinner } from "@kilo-desktop/ui/components/spinner";
import { CircleAlertIcon, RefreshCwIcon } from "lucide-react";

import { friendlyEnvironmentsError } from "./environments-error-message";

/**
 * How long the conda backend (anaconda-bridge-sidecar) may stay unready
 * before the "starting" state offers a manual retry. Within this window the
 * panel stays hopeful and silent — a normal cold start / restart recovers on
 * its own well inside 120s. Past it, we can no longer assume the backend is
 * merely slow, so we surface the retry affordance.
 */
export const PROVIDER_STARTUP_TIMEOUT_MS = 120_000;

/**
 * Full-panel status surfaces for the conda Environments tab: backend warm-up
 * and load failure. Kept out of `EnvironmentsPanel.tsx` so the panel focuses
 * on the table; these are pure, prop-driven presentation.
 */

/**
 * Whether the "starting" state should reveal its manual retry button: the
 * backend has stayed unready past the startup window. A live timer flips this
 * on while mounted so the button appears exactly when the window elapses,
 * without a page interaction.
 */
function useStartupExhausted(startedAt: number, timeoutMs: number): boolean {
	const deadline = startedAt + timeoutMs;
	const [elapsedDeadline, setElapsedDeadline] = useState<number | null>(() =>
		Date.now() >= deadline ? deadline : null,
	);

	useEffect(() => {
		const timer = setTimeout(() => setElapsedDeadline(deadline), deadline - Date.now());
		return () => clearTimeout(timer);
	}, [deadline]);

	return elapsedDeadline === deadline;
}

/**
 * Shown while the conda backend (anaconda-bridge-sidecar) is still starting
 * up or restarting. Within the startup window this reads as "getting ready",
 * not an error, and offers no action — a normal cold start / restart
 * recovers on its own. The manual "Try again" button appears only once we can
 * no longer assume the backend is merely slow: it has stayed unready for
 * `timeoutMs` (default {@link PROVIDER_STARTUP_TIMEOUT_MS}) measured from
 * `startedAt`.
 */
export function EnvironmentsStartingState({
	onRetry,
	startedAt,
	timeoutMs = PROVIDER_STARTUP_TIMEOUT_MS,
}: {
	onRetry: () => void;
	/** Epoch ms when the not-ready condition began. */
	startedAt: number;
	/** Startup grace period before offering a manual retry. */
	timeoutMs?: number;
}) {
	const exhausted = useStartupExhausted(startedAt, timeoutMs);

	return (
		<Empty className="border" data-qa-id="environments-conda-starting">
			<EmptyHeader>
				<EmptyMedia>
					<Spinner className="text-primary size-8" aria-label="Starting the conda backend" />
				</EmptyMedia>
				<EmptyTitle>Starting the conda backend</EmptyTitle>
				<EmptyDescription>
					{exhausted
						? "This is taking longer than expected. The conda backend may have failed to start."
						: "This can take a moment the first time, or right after an update. Your environments will appear as soon as it\u2019s ready."}
				</EmptyDescription>
			</EmptyHeader>
			{exhausted ? (
				<EmptyContent>
					<Button
						variant="outline"
						onClick={onRetry}
						data-qa-id="environments-conda-starting-retry"
					>
						<RefreshCwIcon data-icon="inline-start" aria-hidden="true" />
						Try again
					</Button>
				</EmptyContent>
			) : null}
		</Empty>
	);
}

/**
 * Friendly failure state for a non-transient environments load error. The
 * raw KernelError message (Python traceback fragments, JSON-RPC plumbing)
 * is translated to curated copy via {@link friendlyEnvironmentsError}; the
 * user can retry the read.
 */
export function EnvironmentsErrorState({
	error,
	onRetry,
}: {
	error: unknown;
	onRetry: () => void;
}) {
	return (
		<Empty className="border" role="alert" data-qa-id="environments-conda-error">
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<CircleAlertIcon aria-hidden="true" />
				</EmptyMedia>
				<EmptyTitle>Could not load environments</EmptyTitle>
				<EmptyDescription>
					{friendlyEnvironmentsError(
						error,
						"Something went wrong while loading your environments.",
					)}
				</EmptyDescription>
			</EmptyHeader>
			<EmptyContent>
				<Button variant="outline" onClick={onRetry} data-qa-id="environments-conda-error-retry">
					<RefreshCwIcon data-icon="inline-start" aria-hidden="true" />
					Try again
				</Button>
			</EmptyContent>
		</Empty>
	);
}
