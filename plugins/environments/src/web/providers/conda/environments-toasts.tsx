import { toast } from "@kilo-desktop/ui/components/sonner";

import { friendlyEnvironmentsError } from "./environments-error-message";

/**
 * Wording for one long-running environments job. Every job reports through
 * stock sonner `toast.promise`: loading → success, or a failure that stays on
 * screen until dismissed because it is usually actionable ("an environment
 * already exists at that location").
 */
export interface JobToastCopy {
	loading: string;
	loadingDescription?: string;
	success: string;
	successDescription?: string;
	/** "Could not …" title shown when the job fails. */
	errorTitle: string;
	/** Used when the failure carries no recognisable environments error code. */
	errorFallback: string;
}

/** `toast.promise` options for a job; pass `id` to continue an existing toast. */
export function jobToastOptions(copy: JobToastCopy, id?: string | number) {
	return {
		...(id !== undefined ? { id } : {}),
		loading: copy.loading,
		...(copy.loadingDescription ? { description: copy.loadingDescription } : {}),
		success: () => ({ message: copy.success, description: copy.successDescription }),
		error: (reason: unknown) => jobErrorToast(copy, reason),
	};
}

function jobErrorToast(copy: JobToastCopy, reason: unknown) {
	return {
		message: copy.errorTitle,
		description: friendlyEnvironmentsError(reason, copy.errorFallback),
		duration: Infinity,
	};
}

/** Report a job that finished while its dialog was still open. */
export function showJobSuccess(copy: JobToastCopy): void {
	toast.success(copy.success, { description: copy.successDescription });
}

/** Report a job that failed while its dialog was still open. */
export function showJobError(copy: JobToastCopy, reason: unknown): void {
	const { message, ...options } = jobErrorToast(copy, reason);
	toast.error(message, options);
}

function packageCount(count: number): string {
	return `${count} ${count === 1 ? "package" : "packages"}`;
}

export function createEnvironmentJob(envName: string): JobToastCopy {
	return {
		loading: `Creating ${envName}…`,
		loadingDescription: "Resolving dependencies and installing packages.",
		success: `${envName} created`,
		successDescription: "The environment is ready to use.",
		errorTitle: `Could not create ${envName}`,
		errorFallback: "Could not create the environment.",
	};
}

export function importEnvironmentJob(envName: string): JobToastCopy {
	return {
		...createEnvironmentJob(envName),
		errorFallback: "Could not create the environment from the file.",
	};
}

export function deleteEnvironmentJob(envName: string): JobToastCopy {
	return {
		loading: `Deleting ${envName}…`,
		loadingDescription: "Removing the environment and all its packages.",
		success: `${envName} deleted`,
		successDescription: "The environment has been removed.",
		errorTitle: `Could not delete ${envName}`,
		errorFallback: "Could not delete the environment.",
	};
}

export function installPackagesJob(envName: string, count: number): JobToastCopy {
	return {
		loading: `Installing ${packageCount(count)}…`,
		loadingDescription: `Resolving dependencies for ${envName}.`,
		success: "Packages installed",
		successDescription: `${packageCount(count)} installed in ${envName}.`,
		errorTitle: "Could not install packages",
		errorFallback: "Could not install the selected packages.",
	};
}

export function updatePackagesJob(envName: string, count: number): JobToastCopy {
	return {
		loading: `Updating ${packageCount(count)}…`,
		loadingDescription: `Resolving dependencies for ${envName}.`,
		success: "Packages updated",
		successDescription: `${packageCount(count)} updated in ${envName}.`,
		errorTitle: "Could not update packages",
		errorFallback: "Could not update the selected packages.",
	};
}

export function backupEnvironmentJob(envName: string, cloneName: string): JobToastCopy {
	return {
		loading: `Backing up ${envName}…`,
		loadingDescription: `Cloning to ${cloneName} before updating.`,
		success: `${envName} backed up`,
		successDescription: `Saved as ${cloneName}.`,
		errorTitle: `Could not back up ${envName}`,
		errorFallback: "Could not back up the environment.",
	};
}
