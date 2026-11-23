import type { ComponentType, ReactNode } from "react";

import {
	ChevronRightIcon,
	CircleCheckIcon,
	LockKeyholeIcon,
	LogInIcon,
	ShieldAlertIcon,
	ShieldXIcon,
	type LucideIcon,
} from "lucide-react";

import type {
	ToolCallProps,
	ToolRendererImplementation,
	ToolRendererProps,
} from "@kilo-desktop/plugin-chat/contracts";
import { Button } from "@kilo-desktop/ui/components/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@kilo-desktop/ui/components/collapsible";
import { cn } from "@kilo-desktop/ui/lib/utils";

import type { FriendlyEnvironmentsError } from "../providers/conda/environments-error-message";
import { AnacondaSignInIcon, useAnacondaSignIn } from "../providers/conda/PolicyErrorDetails";
import { condaPolicyFailure } from "./conda-policy-failure";
import {
	plainText,
	type BlockedBy,
	type BlockedRow,
	type PolicyCardContent,
	type TextPart,
} from "./policy-card-content";

/**
 * A conda tool call in the chat transcript. A package-policy block, a solve
 * failure the policy may explain, or an Anaconda sign-in refusal becomes a
 * card that reads what is blocked, why, by whom, and what to do next, with
 * "Sign in to Anaconda" where that is the fix. The transcript's default row
 * and the solver output stay one click away under "Details". Every other
 * call is drawn as the transcript would without this renderer.
 */
export function CondaPolicyToolCall({ Original, ...call }: ToolRendererProps) {
	const policyFailure = condaPolicyFailure(call);
	if (!policyFailure) return <Original {...call} />;
	return <PolicyCard {...policyFailure} call={call} Original={Original} />;
}

/** Source Code Pro runs larger than Inter at the same size; this evens out the x-heights. */
const MONO = "font-mono text-[0.92em]";

type Tone = "warning" | "neutral";

const TILE_TONE: Record<Tone, string> = {
	warning: "bg-warning/10 text-warning",
	neutral: "bg-muted text-foreground",
};

function cardIcon(content: PolicyCardContent): { Icon: LucideIcon; tone: Tone } {
	switch (content.kind) {
		case "blocked":
			return { Icon: ShieldXIcon, tone: "warning" };
		case "policy-note":
			return { Icon: ShieldAlertIcon, tone: "warning" };
		case "sign-in":
			return {
				Icon: content.code === "NOT_SIGNED_IN" ? LogInIcon : LockKeyholeIcon,
				tone: "neutral",
			};
	}
}

function PolicyCard({
	content,
	failure,
	call,
	Original,
}: {
	content: PolicyCardContent;
	failure: FriendlyEnvironmentsError;
	call: ToolCallProps;
	Original: ComponentType<ToolCallProps>;
}) {
	const { Icon, tone } = cardIcon(content);
	const details = (
		<DetailsPanel>
			<Original {...call} />
			{failure.detail ? (
				<pre className="bg-muted/50 text-foreground/90 max-h-48 overflow-auto rounded-md p-2.5 font-mono text-xs break-all whitespace-pre-wrap">
					{failure.detail}
				</pre>
			) : null}
		</DetailsPanel>
	);

	return (
		<div
			role="group"
			aria-label={plainText(content.headline)}
			className="bg-background my-2 flex gap-3 rounded-lg border p-3 text-sm"
			data-qa-id="environments-chat-policy-card"
		>
			<div
				className={cn(
					"flex size-8 shrink-0 items-center justify-center rounded-md",
					TILE_TONE[tone],
				)}
			>
				<Icon className="size-4" aria-hidden="true" />
			</div>
			<Collapsible className="flex min-w-0 flex-1 flex-col gap-3">
				<div className="flex min-h-8 flex-col justify-center gap-0.5">
					<p
						className="text-foreground font-medium break-words"
						data-qa-id="environments-chat-policy-card-headline"
					>
						<Headline parts={content.headline} />
					</p>
					<Subline content={content} />
				</div>
				<CardBody content={content} />
				{details}
			</Collapsible>
		</div>
	);
}

function Headline({ parts }: { parts: readonly TextPart[] }) {
	return parts.map((part, index) =>
		part.code ? (
			<code key={index} className={cn(MONO, "break-all")}>
				{part.text}
			</code>
		) : (
			<span key={index}>{part.text}</span>
		),
	);
}

function Subline({ content }: { content: PolicyCardContent }) {
	if (content.kind === "blocked") {
		return content.by ? (
			<p className="text-muted-foreground text-xs">
				<ByPolicy by={content.by} />
			</p>
		) : null;
	}
	return <p className="text-muted-foreground text-xs">{content.subline}</p>;
}

/** "by acme's package policy · organization_policy", or as much of it as is known. */
function ByPolicy({ by }: { by: BlockedBy }) {
	return (
		<>
			by {by.org ? `${by.org}'s` : "your organization's"} package policy
			{by.policy ? (
				<>
					{" · "}
					<PolicyName name={by.policy} />
				</>
			) : null}
		</>
	);
}

function PolicyName({ name }: { name: string }) {
	return <span className={cn(MONO, "break-all")}>{name}</span>;
}

function CardBody({ content }: { content: PolicyCardContent }) {
	switch (content.kind) {
		case "blocked":
			return (
				<>
					<BlockedPackages content={content} />
					<NextStep text={content.nextStep} />
				</>
			);
		case "policy-note":
			return <NextStep text={content.nextStep} />;
		case "sign-in":
			return <SignInRow variant={content.code === "NOT_SIGNED_IN" ? "default" : "outline"} />;
	}
}

function BlockedPackages({
	content,
}: {
	content: Extract<PolicyCardContent, { kind: "blocked" }>;
}) {
	const [only] = content.rows;
	if (content.rows.length === 0) {
		return <p className="text-foreground break-words whitespace-pre-line">{content.summary}</p>;
	}
	if (content.rows.length === 1 && only) {
		// A lone block without a reason has nothing to box: the headline and subline say it all.
		if (!only.reason) return null;
		return (
			<div
				className="bg-muted/50 flex flex-col gap-0.5 rounded-md px-3 py-2"
				data-qa-id="environments-policy-blocked-package"
			>
				<span className="text-muted-foreground text-2xs font-medium tracking-wide uppercase">
					Reason
				</span>
				<Reason reason={only.reason} />
			</div>
		);
	}
	return (
		<ul className="bg-muted/50 divide-border-subtle flex flex-col divide-y rounded-md">
			{content.rows.map((row) => (
				<BlockedPackageRow key={row.key} row={row} />
			))}
		</ul>
	);
}

function BlockedPackageRow({ row }: { row: BlockedRow }) {
	return (
		<li
			className="flex flex-col gap-0.5 px-3 py-2"
			data-qa-id="environments-policy-blocked-package"
		>
			<span className={cn(MONO, "text-foreground font-medium break-all")}>{row.label}</span>
			<Reason reason={row.reason} />
			{row.org || row.policy ? (
				<span className="text-muted-foreground text-xs">
					{row.org}
					{row.org && row.policy ? " · " : null}
					{row.policy ? <PolicyName name={row.policy} /> : null}
				</span>
			) : null}
		</li>
	);
}

function Reason({ reason }: { reason: string | null }) {
	return reason ? (
		<p className="text-foreground break-words" data-qa-id="environments-chat-policy-card-reason">
			{reason}
		</p>
	) : (
		<p className="text-muted-foreground italic">No reason given by the policy.</p>
	);
}

function NextStep({ text }: { text: string }) {
	return (
		<FooterRow>
			<p className="text-muted-foreground text-xs">{text}</p>
		</FooterRow>
	);
}

function SignInRow({ variant }: { variant: "default" | "outline" }) {
	const { available, signingIn, outcome, signIn } = useAnacondaSignIn();
	if (outcome?.status === "signed-in") {
		return (
			<FooterRow>
				<p
					role="status"
					className="text-foreground flex items-center gap-1.5"
					data-qa-id="environments-chat-policy-retry-hint"
				>
					<CircleCheckIcon className="size-3.5 shrink-0" aria-hidden="true" />
					Signed in. Ask the agent to try again.
				</p>
			</FooterRow>
		);
	}
	if (!available) return <FooterRow />;
	return (
		<FooterRow>
			<div className="flex flex-col items-start gap-1.5">
				<Button
					type="button"
					variant={variant}
					size="sm"
					disabled={signingIn}
					onClick={signIn}
					data-qa-id="environments-anaconda-sign-in"
				>
					<AnacondaSignInIcon signingIn={signingIn} />
					Sign in to Anaconda
				</Button>
				{outcome?.status === "failed" ? (
					<p
						className="text-destructive text-xs break-words"
						data-qa-id="environments-anaconda-sign-in-error"
					>
						Could not sign in to Anaconda: {outcome.reason}
					</p>
				) : null}
			</div>
		</FooterRow>
	);
}

/** The card's last row: its next step or action on the left, the quiet "Details" toggle on the right. */
function FooterRow({ children }: { children?: ReactNode }) {
	return (
		<div className="flex items-end justify-between gap-3">
			<div className="min-w-0">{children}</div>
			<DetailsTrigger />
		</div>
	);
}

function DetailsTrigger() {
	return (
		<CollapsibleTrigger
			type="button"
			className="group text-muted-foreground hover:text-foreground flex shrink-0 items-center gap-0.5 text-xs"
			data-qa-id="environments-chat-policy-card-details"
		>
			Details
			<ChevronRightIcon
				className="size-3.5 transition-transform group-aria-expanded:rotate-90"
				aria-hidden="true"
			/>
		</CollapsibleTrigger>
	);
}

function DetailsPanel({ children }: { children: ReactNode }) {
	return <CollapsibleContent className="flex flex-col gap-2">{children}</CollapsibleContent>;
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
