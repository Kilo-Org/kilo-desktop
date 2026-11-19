import { useState } from "react";

import { Button } from "@kilo-desktop/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@kilo-desktop/ui/components/dialog";
import { toast } from "@kilo-desktop/ui/components/sonner";

import {
	errorCardTitle,
	friendlyEnvironmentsError,
	needsAnacondaSignIn,
	type EnvironmentsOperation,
	type FriendlyEnvironmentsError,
} from "./environments-error-message";
import { PolicyErrorDetails } from "./PolicyErrorDetails";
import { useReportPolicyFailureOnce } from "./use-track-policy-failure";

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
	/** What the job does, where a code's usual copy would mislead (see `friendlyEnvironmentsError`). */
	operation?: EnvironmentsOperation;
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
	const error = copy.operation
		? friendlyEnvironmentsError(reason, copy.errorFallback, { operation: copy.operation })
		: friendlyEnvironmentsError(reason, copy.errorFallback);
	return {
		message: copy.errorTitle,
		description: hasPolicyDetails(error) ? (
			<PolicyFailureSummary title={copy.errorTitle} error={error} reason={reason} />
		) : (
			error.message
		),
		duration: Infinity,
	};
}

function hasPolicyDetails({ code, policy }: FriendlyEnvironmentsError): boolean {
	return (
		needsAnacondaSignIn(code) || (policy?.blocked?.length ?? 0) > 0 || policy?.policyNote === true
	);
}

/** The first line of a message, counting the lines left out (a policy block lists one per package). */
function oneLine(message: string): string {
	const [first = "", ...rest] = message
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	return rest.length > 0 ? `${first} (+${rest.length} more)` : first;
}

/**
 * A job's policy or Anaconda sign-in failure in its toast: a one-line
 * summary and "Details", which opens the whole message with
 * {@link PolicyErrorDetails} (blocked packages, policy note, sign-in).
 * Reported once when shown.
 */
function PolicyFailureSummary({
	title,
	error,
	reason,
}: {
	title: string;
	error: FriendlyEnvironmentsError;
	reason: unknown;
}) {
	useReportPolicyFailureOnce(reason);
	const [open, setOpen] = useState(false);
	return (
		<div className="flex flex-col items-start gap-1.5" data-qa-id="environments-job-error-policy">
			<span>{oneLine(error.message)}</span>
			<Button
				type="button"
				variant="outline"
				size="xs"
				onClick={() => setOpen(true)}
				data-qa-id="environments-job-error-details"
			>
				Details
			</Button>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent className="sm:max-w-lg" data-qa-id="environments-job-error-dialog">
					<DialogHeader>
						<DialogTitle>{title}</DialogTitle>
						<DialogDescription>{errorCardTitle(error)}</DialogDescription>
					</DialogHeader>
					<div className="text-muted-foreground flex min-h-0 flex-col gap-3 overflow-y-auto text-sm">
						<p className="text-foreground whitespace-pre-line">{error.message}</p>
						<PolicyErrorDetails code={error.code} policy={error.policy} />
						{error.detail ? (
							<pre className="bg-muted/50 text-foreground/90 max-h-48 overflow-auto rounded-md border p-2.5 font-mono text-xs break-all whitespace-pre-wrap">
								{error.detail}
							</pre>
						) : null}
					</div>
				</DialogContent>
			</Dialog>
		</div>
	);
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
		operation: "clone",
	};
}
