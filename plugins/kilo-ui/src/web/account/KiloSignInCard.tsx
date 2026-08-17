import { ArrowUpRightIcon, Building2Icon, SparklesIcon, ZapIcon } from "lucide-react";

import { Button } from "@anaconda-agentic-desktop/ui/components/button";
import {
	Item,
	ItemContent,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from "@anaconda-agentic-desktop/ui/components/item";
import { Separator } from "@anaconda-agentic-desktop/ui/components/separator";

import { KiloMark } from "./KiloMark.js";

const SIGN_IN_BENEFITS = [
	{ Icon: SparklesIcon, label: "500+ models" },
	{ Icon: ZapIcon, label: "Credits & Kilo Pass" },
	{ Icon: Building2Icon, label: "Team workspaces" },
] as const;

/** Signed-out CTA used by Settings and the first-run onboarding wizard. */
export function KiloSignInCard({ onLogin }: { onLogin: () => void }) {
	return (
		<div
			className="border-border bg-card overflow-hidden rounded-xl border"
			data-qa-id="kilo-account-signed-out"
		>
			<div className="flex flex-col items-center px-6 pt-8 pb-6 text-center">
				<KiloMark size="lg" />
				<h2 className="font-heading mt-5 text-lg font-semibold tracking-tight">
					Connect your Kilo account
				</h2>
				<p className="text-muted-foreground mt-1.5 max-w-sm text-sm text-balance">
					One sign-in for frontier models, your credit balance, and team workspaces — without
					leaving the app.
				</p>
				<Button
					type="button"
					size="lg"
					className="mt-5"
					onClick={onLogin}
					data-qa-id="kilo-account-login"
				>
					Sign in to Kilo
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
						<ItemMedia variant="icon" className="text-primary">
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
