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

/** Success toast shown when packages finish installing. */
export function showPackagesInstalledToast(
	envName: string,
	count: number,
	toastId?: string | number,
): void {
	toast.success(`Packages installed`, {
		...(toastId !== undefined ? { id: toastId } : {}),
		description: `${count} ${count === 1 ? "package" : "packages"} installed in ${envName}.`,
	});
}

/** Success toast shown when packages finish updating. */
export function showPackagesUpdatedToast(
	envName: string,
	count: number,
	toastId?: string | number,
): void {
	toast.success(`Packages updated`, {
		...(toastId !== undefined ? { id: toastId } : {}),
		description: `${count} ${count === 1 ? "package" : "packages"} updated in ${envName}.`,
	});
}

/**
 * Track an already-running install job as a background toast:
 * loading → success or persistent error.
 */
export function trackBackgroundInstallToast(
	promise: Promise<unknown>,
	envName: string,
	count: number,
	errorFallback: string,
): void {
	const toastId = toast.loading(`Installing ${count} ${count === 1 ? "package" : "packages"}…`, {
		description: `Resolving dependencies for ${envName}.`,
	});
	promise.then(
		() => {
			showPackagesInstalledToast(envName, count, toastId);
		},
		(reason) => {
			showEnvironmentsErrorToast("Install failed", reason, errorFallback, toastId);
		},
	);
}

/**
 * Track a delete-environment job as a background toast:
 * loading → success or persistent error. The dialog closes immediately
 * and this toast takes over progress reporting.
 */
export function trackBackgroundDeleteToast(promise: Promise<unknown>, envName: string): void {
	const toastId = toast.loading(`Deleting ${envName}…`, {
		description: "Removing the environment and all its packages.",
	});
	promise.then(
		() => {
			toast.success(`${envName} deleted`, {
				id: toastId,
				description: "The environment has been removed.",
			});
		},
		(reason) => {
			showEnvironmentsErrorToast(
				`Failed to delete ${envName}`,
				reason,
				"Could not delete environment.",
				toastId,
			);
		},
	);
}
