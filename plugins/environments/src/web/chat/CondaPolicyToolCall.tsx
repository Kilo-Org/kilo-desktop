import { useState, type ComponentType } from "react";

import { ChevronRightIcon, LogInIcon, ShieldAlertIcon } from "lucide-react";

import { useDomainObject } from "@kilo-desktop/kernel/web";
import { AnacondaAccount } from "@kilo-desktop/plugin-anaconda/contracts";
import type {
	ToolCallProps,
	ToolRendererImplementation,
	ToolRendererProps,
} from "@kilo-desktop/plugin-chat/contracts";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@kilo-desktop/ui/components/collapsible";

import {
	errorCardTitle,
	type FriendlyEnvironmentsError,
} from "../providers/conda/environments-error-message";
import { PolicyErrorDetails } from "../providers/conda/PolicyErrorDetails";
import { condaPolicyFailure } from "./conda-policy-failure";

/**
 * A conda tool call in the chat transcript. A package-policy block, a solve
 * failure the policy may explain, or an Anaconda sign-in refusal becomes a
 * card the person can act on: the blocked packages verbatim, the policy note,
 * "Sign in to Anaconda". The transcript's default row stays one click away.
 * Every other call is drawn as the transcript would without this renderer.
 */
export function CondaPolicyToolCall({ Original, ...call }: ToolRendererProps) {
	const failure = condaPolicyFailure(call);
	if (!failure) return <Original {...call} />;
	return <PolicyFailureCard failure={failure} call={call} Original={Original} />;
}

function PolicyFailureCard({
	failure,
	call,
	Original,
}: {
	failure: FriendlyEnvironmentsError;
	call: ToolCallProps;
	Original: ComponentType<ToolCallProps>;
}) {
	const anaconda = useDomainObject(AnacondaAccount);
	const [signedIn, setSignedIn] = useState(false);
	const needsSignIn = failure.code === "NOT_SIGNED_IN" || failure.code === "CHANNEL_ACCESS_DENIED";
	const title = errorCardTitle(failure);
	const Icon = needsSignIn ? LogInIcon : ShieldAlertIcon;

	return (
		<div
			role="group"
			aria-label={title}
			className="border-border bg-background my-2 flex flex-col gap-2 rounded-md border p-3 text-sm"
			data-qa-id="environments-chat-policy-card"
		>
			<div className="flex items-center gap-2 font-medium">
				<Icon className="text-muted-foreground size-3.5 shrink-0" aria-hidden="true" />
				{title}
			</div>
			<div className="text-muted-foreground flex flex-col gap-2">
				<p className="whitespace-pre-line">{failure.message}</p>
				<PolicyErrorDetails
					code={failure.code}
					policy={failure.policy}
					onSignedIn={() => setSignedIn(true)}
				/>
				{needsSignIn && anaconda ? (
					<p data-qa-id="environments-chat-policy-retry-hint">
						{signedIn
							? "Ask the agent to try again."
							: "After you sign in, ask the agent to try again."}
					</p>
				) : null}
			</div>
			<Collapsible>
				<CollapsibleTrigger
					type="button"
					className="group text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs"
					data-qa-id="environments-chat-policy-card-details"
				>
					<ChevronRightIcon
						className="size-3.5 transition-transform group-aria-expanded:rotate-90"
						aria-hidden="true"
					/>
					Details
				</CollapsibleTrigger>
				<CollapsibleContent className="flex flex-col gap-2 pt-2">
					<Original {...call} />
					{failure.detail ? (
						<pre className="bg-muted/50 text-foreground/90 max-h-48 overflow-auto rounded-md border p-2.5 font-mono text-xs break-all whitespace-pre-wrap">
							{failure.detail}
						</pre>
					) : null}
				</CollapsibleContent>
			</Collapsible>
		</div>
	);
}

/**
 * kilo.environments' `kilo.chat/tool-renderer` for the conda tools that
 * resolve packages: only the calls it draws as a card stand alone, outside
 * the activity groups and the settled turn's fold, so they stay in sight.
 */
export const condaPolicyToolRenderer: ToolRendererImplementation = {
	component: CondaPolicyToolCall,
	isStandalone: (call) => condaPolicyFailure(call) !== null,
};
