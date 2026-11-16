import {
	ArrowUpRightIcon,
	Building2Icon,
	CheckIcon,
	CopyIcon,
	SearchIcon,
	SparklesIcon,
	ZapIcon,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";

import { Button, buttonVariants } from "@kilo-desktop/ui/components/button";
import { ExternalLink } from "@kilo-desktop/ui/components/external-link";
import { Spinner } from "@kilo-desktop/ui/components/spinner";
import { cn } from "@kilo-desktop/ui/lib/utils";

import { DeviceAuthPanel, formatTime, useDeviceAuthCountdown } from "../settings/DeviceAuthPanel";
import type { DeviceSignInState } from "@kilo-desktop/plugin-core/contracts";
import type { KiloAccountView } from "../use-kilo-account";
import { KiloMark } from "../settings/KiloMark";
import { ProviderIcon } from "@kilo-desktop/ui/components/provider-icon";
import { filterShowcaseModels, SHOWCASE_QUERIES, typingScript } from "./showcase-models";

const BENEFITS = [
	{
		Icon: SparklesIcon,
		title: "500+ models",
		description: "Frontier and open models from every major lab.",
	},
	{
		Icon: ZapIcon,
		title: "Credits & Kilo Pass",
		description: "One balance across every provider.",
	},
	{
		Icon: Building2Icon,
		title: "Team workspaces",
		description: "Organization settings and billing, shared.",
	},
] as const;

export function SignInStep({
	auth,
	onCopy,
}: {
	auth: KiloAccountView;
	onCopy: (text: string) => void;
}) {
	if (auth.deviceSignIn.status === "waiting") {
		return (
			<ApproveInBrowser
				deviceAuth={auth.deviceSignIn}
				onCancel={auth.cancelSignIn}
				onOpenBrowser={auth.openExternal}
				onCopy={onCopy}
			/>
		);
	}

	if (auth.deviceSignIn.status !== "idle") {
		return (
			<DeviceAuthPanel
				deviceAuth={auth.deviceSignIn}
				onCancel={auth.cancelSignIn}
				onRetry={auth.signIn}
				onOpenBrowser={auth.openExternal}
				onCopy={onCopy}
			/>
		);
	}

	if (auth.signedIn === null) {
		return (
			<div
				data-qa-id="onboarding-connecting"
				className="text-muted-foreground flex items-center gap-3 text-sm"
			>
				<Spinner />
				Connecting to Kilo…
			</div>
		);
	}

	if (auth.signedIn === true) {
		const name = auth.profile?.profile.name ?? auth.profile?.profile.email ?? "Kilo";
		const email = auth.profile?.profile.name ? auth.profile.profile.email : null;
		return (
			<div data-qa-id="onboarding-signed-in" className="flex items-center gap-4">
				<span className="bg-success-surface text-success grid size-10 shrink-0 place-items-center rounded-full">
					<CheckIcon className="size-5" aria-hidden="true" />
				</span>
				<div className="flex min-w-0 flex-col">
					<span className="truncate text-sm font-medium">Signed in as {name}</span>
					<span className="text-muted-foreground truncate text-sm">
						{email ?? "Continue to create your first workspace."}
					</span>
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-6">
			<div className="flex flex-col items-start gap-2.5">
				<Button type="button" onClick={auth.signIn} data-qa-id="kilo-account-login">
					<KiloMark className="size-4 text-current" />
					Sign in with Kilo
					<ArrowUpRightIcon data-icon="inline-end" />
				</Button>
				<span className="text-muted-foreground text-xs">
					Opens your browser to finish signing in.
				</span>
			</div>
			<ul className="flex flex-col gap-4">
				{BENEFITS.map(({ Icon, title, description }) => (
					<li key={title} className="flex items-start gap-3">
						<span className="bg-muted text-foreground grid size-8 shrink-0 place-items-center rounded-lg">
							<Icon className="size-4" aria-hidden="true" />
						</span>
						<div className="flex flex-col">
							<span className="text-sm font-medium">{title}</span>
							<span className="text-muted-foreground text-sm">{description}</span>
						</div>
					</li>
				))}
			</ul>
		</div>
	);
}

/**
 * Onboarding's waiting-for-approval view: the confirmation code as the focal
 * point with the countdown beneath it, then a row of actions. Other device-auth
 * states (contacting, error, finishing) reuse the shared panel.
 */
function ApproveInBrowser({
	deviceAuth,
	onCancel,
	onOpenBrowser,
	onCopy,
}: {
	deviceAuth: DeviceSignInState;
	onCancel: () => void;
	onOpenBrowser: (url: string) => void;
	onCopy: (text: string) => void;
}) {
	const remaining = useDeviceAuthCountdown(deviceAuth);
	const { code, verificationUrl } = deviceAuth;

	return (
		<div data-qa-id="kilo-account-device-auth" data-state="waiting" className="flex flex-col gap-5">
			<div className="flex flex-col gap-1">
				<span className="text-sm font-medium">Approve the sign-in in your browser</span>
				<span className="text-muted-foreground text-sm">
					Check that this code matches the one shown there.
				</span>
			</div>

			<div className="bg-foreground/5 flex items-center justify-between gap-3 rounded-xl py-3 pr-2 pl-4">
				<code
					className="truncate text-2xl font-semibold tracking-[0.2em]"
					data-qa-id="kilo-account-device-code"
				>
					{code ?? "————"}
				</code>
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					aria-label="Copy code"
					disabled={!code}
					onClick={() => code && onCopy(code)}
					data-qa-id="kilo-account-copy-code"
				>
					<CopyIcon />
				</Button>
			</div>

			<span className="text-muted-foreground -mt-2 flex items-center gap-2 text-xs">
				<Spinner className="size-3.5" />
				Waiting for approval
				<span aria-hidden="true">·</span>
				<span className="tabular-nums" aria-label={`${formatTime(remaining)} remaining`}>
					{formatTime(remaining)}
				</span>
			</span>

			<div className="flex flex-wrap items-center gap-2">
				<Button
					type="button"
					variant="ghost"
					className="mr-auto -ml-2.5"
					onClick={onCancel}
					data-qa-id="kilo-account-cancel"
				>
					Cancel
				</Button>
				{verificationUrl ? (
					<>
						<Button
							type="button"
							variant="outline"
							onClick={() => onCopy(verificationUrl)}
							data-qa-id="kilo-account-copy-url"
						>
							<CopyIcon data-icon="inline-start" />
							Copy link
						</Button>
						<ExternalLink
							href={verificationUrl}
							onOpen={onOpenBrowser}
							className={buttonVariants()}
							data-qa-id="kilo-account-open-browser"
						>
							Open browser
							<ArrowUpRightIcon data-icon="inline-end" />
						</ExternalLink>
					</>
				) : null}
			</div>
		</div>
	);
}

const SCRIPT = typingScript(SHOWCASE_QUERIES);

/** Steps through the typing script forever; frozen on the idle list under reduced motion. */
function useScriptedQuery(): string {
	const reduceMotion = useReducedMotion() === true;
	const [frame, setFrame] = useState(0);
	useEffect(() => {
		if (reduceMotion) return;
		const timer = window.setTimeout(
			() => setFrame((current) => (current + 1) % SCRIPT.length),
			SCRIPT[frame]!.holdMs,
		);
		return () => window.clearTimeout(timer);
	}, [frame, reduceMotion]);
	return reduceMotion ? "" : SCRIPT[frame]!.text;
}

/**
 * Decorative model picker that types its own searches ("cl", "gpt", "gem")
 * and filters live. The search field is top-anchored in a fixed-height frame
 * so only the results grow and shrink.
 */
export function SignInShowcase() {
	const query = useScriptedQuery();
	const models = filterShowcaseModels(query);

	return (
		<div className="h-80">
			<div className="bg-popover text-popover-foreground overflow-hidden rounded-2xl shadow-xl shadow-black/25">
				<div className="bg-foreground/3 flex h-11 items-center gap-2.5 px-4 text-sm">
					<SearchIcon className="text-muted-foreground size-4 shrink-0" />
					{query ? <span>{query}</span> : null}
					<motion.span
						aria-hidden="true"
						className="bg-foreground -mx-1.5 h-4 w-px"
						animate={{ opacity: [1, 1, 0, 0] }}
						transition={{ duration: 1, repeat: Infinity, times: [0, 0.5, 0.5, 1] }}
					/>
					{query ? null : <span className="text-muted-foreground">Search 500+ models</span>}
				</div>
				<ul className="flex flex-col gap-0.5 px-2.5 py-1.5">
					<AnimatePresence initial={false} mode="popLayout">
						{models.map(({ provider, name, lab }, index) => (
							<motion.li
								key={name}
								layout="position"
								initial={{ opacity: 0 }}
								animate={{ opacity: 1 }}
								exit={{ opacity: 0 }}
								transition={{ duration: 0.15 }}
								className={cn(
									"flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-sm",
									index === 0 && "bg-foreground/6",
								)}
							>
								<ProviderIcon provider={provider} variant="color" size={16} />
								<MatchedName name={name} query={query} />
								<span className="text-muted-foreground text-xs">{lab}</span>
								<CheckIcon className={cn("size-3.5", index !== 0 && "invisible")} />
							</motion.li>
						))}
					</AnimatePresence>
				</ul>
				<div className="bg-foreground/3 text-muted-foreground flex h-8 items-center px-4 text-[11px]">
					{query ? `${models.length} matches` : "500+ models from every major lab"}
				</div>
			</div>
		</div>
	);
}

function MatchedName({ name, query }: { name: string; query: string }) {
	if (!query)
		return (
			<span className="flex-1 truncate" data-qa-id="showcase-model-name">
				{name}
			</span>
		);
	return (
		<span className="flex-1 truncate" data-qa-id="showcase-model-name">
			<span className="font-medium">{name.slice(0, query.length)}</span>
			<span className="text-muted-foreground">{name.slice(query.length)}</span>
		</span>
	);
}
