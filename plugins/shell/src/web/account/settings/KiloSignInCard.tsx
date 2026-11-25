import { ArrowUpRightIcon, Building2Icon, SparklesIcon, ZapIcon } from "lucide-react";

import { Button } from "@kilo-desktop/ui/components/button";
import {
	Item,
	ItemContent,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from "@kilo-desktop/ui/components/item";
import { Separator } from "@kilo-desktop/ui/components/separator";
import { cn } from "@kilo-desktop/ui/lib/utils";

import { KiloMark } from "./KiloMark";

const SIGN_IN_BENEFITS = [
	{ Icon: SparklesIcon, label: "500+ models" },
	{ Icon: ZapIcon, label: "Credits & Kilo Pass" },
	{ Icon: Building2Icon, label: "Team workspaces" },
] as const;

/** Signed-out CTA used by Settings and the first-run onboarding wizard. */
export function KiloSignInCard({
	onLogin,
	embedded = false,
	expired = false,
}: {
	onLogin: () => void;
	/** Skip the outer frame when nested inside another bordered card. */
	embedded?: boolean;
	/** The previous sign-in stopped working, so this asks to sign in again. */
	expired?: boolean;
}) {
	return (
		<div
			className={cn("overflow-hidden", !embedded && "border-border bg-card rounded-xl border")}
			data-qa-id="kilo-account-signed-out"
		>
			<div className="flex flex-col items-center px-6 pt-6 pb-5 text-center">
				<KiloMark />
				<h2 className="mt-4 text-sm font-medium">
					{expired ? "Your Kilo sign-in has expired or was revoked" : "Connect your Kilo account"}
				</h2>
				<p className="text-muted-foreground mt-1.5 max-w-sm text-sm text-balance">
					{expired
						? "Sign in again to keep using your models, credit balance, and team workspaces."
						: "One connection for frontier models, your credit balance, and team workspaces — without leaving the app."}
				</p>
				<Button type="button" className="mt-4" onClick={onLogin} data-qa-id="kilo-account-login">
					Sign in
					<ArrowUpRightIcon data-icon="inline-end" />
				</Button>
			</div>
			<Separator />
			<ItemGroup className="grid grid-cols-3 gap-2 p-3">
				{SIGN_IN_BENEFITS.map(({ Icon, label }) => (
					<Item
						key={label}
						variant="muted"
						size="sm"
						role="listitem"
						className="flex-col justify-center"
					>
						<ItemMedia variant="icon" className="text-primary-ink">
							<Icon />
						</ItemMedia>
						<ItemContent className="items-center">
							<ItemTitle>{label}</ItemTitle>
						</ItemContent>
					</Item>
				))}
			</ItemGroup>
		</div>
	);
}
