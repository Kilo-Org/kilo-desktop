import { ArrowRightIcon } from "lucide-react";
import { motion } from "motion/react";
import { useRef } from "react";

import { Button } from "@kilo-desktop/ui/components/button";
import { Checkbox } from "@kilo-desktop/ui/components/checkbox";
import { DialogDescription, DialogTitle } from "@kilo-desktop/ui/components/dialog";
import { KILO_TERMS_URL } from "@kilo-desktop/plugin-core/contracts";

import { KiloWelcomeLogo } from "@kilo-desktop/ui/components/brand/kilo-welcome-logo";

import { DotGrid } from "./DotGrid";

const EASE = [0.16, 1, 0.3, 1] as const;

/** The kilo.ai hero entrance: fade up out of a light blur. */
const blurUp = (delay: number) => ({
	initial: { opacity: 0, y: 12, filter: "blur(6px)" },
	animate: { opacity: 1, y: 0, filter: "blur(0px)" },
	transition: { duration: 0.6, ease: EASE, delay },
});

/**
 * Opening splash, modelled on the kilo.ai hero. The Kilo logo drops onto the
 * interactive dot grid and its landing sends a gradient ripple across the
 * window; the copy then blurs up. The pointer drags a glowing trail through
 * the dots, a click anywhere sends another ripple, and hovering the logo plays
 * the animated mark. Get started stays disabled until the user accepts the
 * terms of service.
 */
export function WelcomeStep({
	termsAccepted,
	busy = false,
	error = null,
	onTermsAcceptedChange,
	onContinue,
}: {
	termsAccepted: boolean;
	/** Recording the acceptance is in flight. */
	busy?: boolean;
	error?: string | null;
	onTermsAcceptedChange: (accepted: boolean) => void;
	onContinue: () => void;
}) {
	const logoRef = useRef<HTMLDivElement>(null);

	return (
		<div
			data-qa-id="onboarding-welcome"
			className="relative isolate flex flex-1 flex-col items-center justify-center gap-8 overflow-hidden px-6 pt-12 pb-16 text-center"
		>
			<div aria-hidden="true" className="absolute inset-0 -z-10">
				<DotGrid introOrigin={logoRef} />
			</div>

			<motion.div
				className="flex flex-col items-center gap-2.5"
				initial={{ opacity: 0, scale: 1.35, filter: "blur(8px)" }}
				animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
				transition={{ duration: 0.3, ease: [0.5, 0, 0.75, 0] }}
			>
				{/* The ripple starts from the mark itself, not the whole lockup. */}
				<div ref={logoRef}>
					<KiloWelcomeLogo className="text-foreground mb-0" sizeClassName="size-16" />
				</div>
			</motion.div>

			<motion.div className="flex flex-col items-center gap-2" {...blurUp(0.25)}>
				<DialogTitle render={<h1 />} className="text-2xl font-medium tracking-tight">
					Welcome to Kilo
				</DialogTitle>
				<DialogDescription className="max-w-sm text-balance">
					Your agentic workspace for code, data, and models
				</DialogDescription>
			</motion.div>

			<motion.div className="flex flex-col items-center gap-8" {...blurUp(0.35)}>
				<label className="text-muted-foreground flex max-w-sm cursor-pointer items-center gap-4 text-left text-sm">
					<Checkbox
						className="border-muted-foreground size-5 rounded-[5px] [&_svg]:size-4"
						checked={termsAccepted}
						onCheckedChange={(checked) => onTermsAcceptedChange(checked === true)}
						data-qa-id="onboarding-accept-terms"
					/>
					<span className="text-pretty">
						By checking this box, I&nbsp;agree to the{" "}
						<a
							href={KILO_TERMS_URL}
							target="_blank"
							rel="noreferrer"
							className="text-foreground underline underline-offset-3 hover:no-underline"
							data-qa-id="onboarding-terms-link"
						>
							terms of service
						</a>
						.
					</span>
				</label>
				{error ? (
					<p role="alert" className="text-destructive text-sm" data-qa-id="onboarding-terms-error">
						{error}
					</p>
				) : null}
				<Button
					type="button"
					disabled={!termsAccepted || busy}
					onClick={onContinue}
					data-qa-id="onboarding-get-started"
				>
					Get started
					<ArrowRightIcon data-icon="inline-end" />
				</Button>
			</motion.div>
		</div>
	);
}
