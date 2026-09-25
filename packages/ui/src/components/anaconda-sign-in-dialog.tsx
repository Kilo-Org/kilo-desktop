import { ArrowRightIcon } from "lucide-react";

import { cn } from "@kilo-desktop/ui/lib/utils";
import { AnacondaLogo } from "@kilo-desktop/ui/components/anaconda-logo";
import { Button } from "@kilo-desktop/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@kilo-desktop/ui/components/dialog";
import { Spinner } from "@kilo-desktop/ui/components/spinner";

const PRIVACY_POLICY_URL = "https://www.anaconda.com/privacy-policy";
const TERMS_OF_SERVICE_URL = "https://www.anaconda.com/legal/terms/terms-of-service";

export interface AnacondaSignInDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Start the Anaconda OAuth sign-in flow. */
	onSignIn: () => void;
	/** Disables the button and swaps it for a spinner while the flow runs. */
	pending?: boolean | undefined;
	/** Failure reason from a previous attempt, shown under the button. */
	error?: string | undefined;
	className?: string | undefined;
}

/**
 * "Sign in to Anaconda" modal shared by features that gate Anaconda-account
 * functionality (model catalog, Anaconda package channels). Purely
 * presentational — the consumer owns the login call so sign-in works the
 * same everywhere while session state stays with the feature.
 */
export function AnacondaSignInDialog({
	open,
	onOpenChange,
	onSignIn,
	pending = false,
	error,
	className,
}: AnacondaSignInDialogProps) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				className={cn(
					"z-[61] w-80 max-w-[calc(100%-2rem)] gap-0 rounded-xl p-5 text-center sm:max-w-xs",
					className,
				)}
				overlayClassName="z-[60]"
				visualOverlayClassName="z-[60]"
				data-qa-id="anaconda-sign-in-dialog"
			>
				<div className="flex flex-col items-center gap-3">
					<AnacondaLogo className="size-8 text-(--color-green-700)" />
					<div className="flex flex-col gap-1">
						<p className="text-muted-foreground text-2xs font-semibold tracking-[0.14em] uppercase">
							Anaconda Account
						</p>
						<DialogTitle className="text-lg leading-tight font-semibold">
							Sign in to Anaconda
						</DialogTitle>
						<DialogDescription className="text-sm leading-snug text-pretty">
							Continue your journey with Anaconda
							<br />
							and access all your tools and features.
						</DialogDescription>
					</div>
					<Button
						type="button"
						disabled={pending}
						onClick={onSignIn}
						data-qa-id="anaconda-sign-in-submit"
					>
						{pending ? (
							<>
								<Spinner data-icon="inline-start" aria-hidden="true" />
								Signing in…
							</>
						) : (
							<>
								Sign in
								<ArrowRightIcon data-icon="inline-end" aria-hidden="true" />
							</>
						)}
					</Button>
					{error ? (
						<p
							className="text-destructive text-sm"
							role="alert"
							data-qa-id="anaconda-sign-in-error"
						>
							{error}
						</p>
					) : null}
					<p className="text-muted-foreground text-2xs leading-relaxed text-pretty">
						By clicking Sign in with Email, or signing in with Google, Microsoft, or GitHub, I agree
						to the collection of my data, Anaconda's{" "}
						<a href={PRIVACY_POLICY_URL} target="_blank" rel="noreferrer" className="underline">
							Privacy Policy
						</a>{" "}
						and{" "}
						<a href={TERMS_OF_SERVICE_URL} target="_blank" rel="noreferrer" className="underline">
							Terms of Service
						</a>
						. These terms do not supersede any existing Master Subscription Agreement or other
						enterprise agreement entered into with Anaconda.
					</p>
				</div>
			</DialogContent>
		</Dialog>
	);
}
