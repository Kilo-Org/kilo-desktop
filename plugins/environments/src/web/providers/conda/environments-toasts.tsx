import { toast } from "@anaconda-agentic-desktop/ui/components/sonner";
import { OctagonXIcon } from "lucide-react";

import { friendlyEnvironmentsError } from "./environments-error-message.js";

/**
 * Persistent, right-side error toast for environments failures. Failures
 * (e.g. "an environment already exists at that location") are actionable and
 * must not disappear before the user reads them, so the toast never
 * auto-dismisses (`duration: Infinity`) — the user closes it. Pass `toastId`
 * to replace an in-flight loading toast in place.
 */
export function showEnvironmentsErrorToast(
	title: string,
	reason: unknown,
	fallback: string,
	toastId?: string | number,
): void {
	toast.error(title, {
		...(toastId !== undefined ? { id: toastId } : {}),
		description: friendlyEnvironmentsError(reason, fallback),
		duration: Infinity,
		icon: <OctagonXIcon className="text-destructive size-5" />,
	});
}

/** Success toast shown when an environment finishes creating. */
export function showEnvironmentCreatedToast(envName: string, toastId?: string | number): void {
	toast.success(`${envName} created`, {
		...(toastId !== undefined ? { id: toastId } : {}),
		description: "The environment is ready to use.",
	});
}

/**
 * Track an already-running create/import job as a background toast:
 * loading → success or persistent error. Attaches to the job's existing
 * promise — callers must NOT start a second job for the same work.
 */
export function trackBackgroundCreateToast(
	promise: Promise<unknown>,
	envName: string,
	errorFallback: string,
): void {
	const toastId = toast.loading(`Creating ${envName}…`, {
		description: "Resolving dependencies and installing packages.",
	});
	promise.then(
		() => {
			showEnvironmentCreatedToast(envName, toastId);
		},
		(reason) => {
			showEnvironmentsErrorToast(`Failed to create ${envName}`, reason, errorFallback, toastId);
		},
	);
}
