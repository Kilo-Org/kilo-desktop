import type { ReactNode } from "react";

import { CircleAlertIcon, RefreshCwIcon } from "lucide-react";

import { Button } from "@kilo-desktop/ui/components/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@kilo-desktop/ui/components/empty";
import { cn } from "@kilo-desktop/ui/lib/utils";

import { type FriendlyEnvironmentsError, needsAnacondaSignIn } from "./environments-error-message";
import { PolicyErrorDetails } from "./PolicyErrorDetails";
import { useReportPolicyFailureOnce } from "./use-track-policy-failure";

interface FailureProps {
	/** What was caught; reported once as `environment-policy-blocked` when it is a policy failure. */
	reason: unknown;
	/** {@link friendlyEnvironmentsError} of `reason`. */
	error: FriendlyEnvironmentsError;
	qaId: string;
}

/**
 * A failure shown in place, under the control that failed: the friendly
 * message, then {@link PolicyErrorDetails} (blocked packages, policy note,
 * "Sign in to Anaconda"), then `children` (e.g. a "Try again").
 */
export function InlineFailure({
	reason,
	error,
	qaId,
	onSignedIn,
	className,
	children,
}: FailureProps & {
	/** After an Anaconda sign-in, e.g. to run the failed request again. */
	onSignedIn?: () => void;
	className?: string;
	children?: ReactNode;
}) {
	useReportPolicyFailureOnce(reason);
	return (
		<div
			className={cn("text-destructive flex flex-col gap-2 text-sm", className)}
			role="alert"
			data-qa-id={qaId}
		>
			<span className="whitespace-pre-line">{error.message}</span>
			<PolicyErrorDetails
				code={error.code}
				policy={error.policy}
				className="text-muted-foreground"
				{...(onSignedIn ? { onSignedIn } : {})}
			/>
			{children}
		</div>
	);
}

/**
 * A failure that replaces a list (package search, the channel list): a
 * "Sign in to Anaconda" state for NOT_SIGNED_IN / CHANNEL_ACCESS_DENIED, whose
 * sign-in retries, otherwise `title` with the friendly message and "Try again".
 */
export function FailureEmptyState({
	reason,
	error,
	qaId,
	title,
	onRetry,
}: FailureProps & { title: string; onRetry: () => void }) {
	useReportPolicyFailureOnce(reason);
	const signIn = needsAnacondaSignIn(error.code);
	return (
		<Empty className="border" data-qa-id={qaId}>
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<CircleAlertIcon aria-hidden="true" />
				</EmptyMedia>
				<EmptyTitle>{signIn ? "Sign in to Anaconda" : title}</EmptyTitle>
				<EmptyDescription className="whitespace-pre-line">{error.message}</EmptyDescription>
			</EmptyHeader>
			<EmptyContent>
				<PolicyErrorDetails
					code={error.code}
					policy={error.policy}
					className="text-muted-foreground items-center text-sm"
					onSignedIn={onRetry}
				/>
				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={onRetry}
					data-qa-id={`${qaId}-retry`}
				>
					<RefreshCwIcon data-icon="inline-start" aria-hidden="true" />
					Try again
				</Button>
			</EmptyContent>
		</Empty>
	);
}
