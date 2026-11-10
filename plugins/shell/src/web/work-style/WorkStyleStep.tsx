import { CheckIcon, FilePenIcon, InfoIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import { WORK_STYLES, type WorkStyle } from "@kilo-desktop/plugin-core/contracts";
import { FieldError } from "@kilo-desktop/ui/components/field";
import { RadioGroup, RadioGroupItem } from "@kilo-desktop/ui/components/radio-group";
import { cn } from "@kilo-desktop/ui/lib/utils";

// Wording copied from the Kilo VS Code extension (webview-ui/src/i18n/en.ts,
// `workStyle.choice.*`). Its "visibility" bullets are dropped: they describe
// display preferences Desktop doesn't have.
const CHOICE_COPY: Record<WorkStyle, { title: string; description: string; detail: string }> = {
	"human-in-the-loop": {
		title: "Review first",
		description: "Kilo pauses and shows you its plan as it works.",
		detail: "Asks before editing files or running commands.",
	},
	autonomous: {
		title: "High autonomy",
		description: "Fewer interruptions, streamlined interface.",
		detail: "Edits files and runs commands in the workspace without asking.",
	},
};

export function WorkStyleStep({
	value,
	onValueChange,
	disabled,
	replacesExistingRules,
	error,
}: {
	value: WorkStyle | null;
	onValueChange: (style: WorkStyle) => void;
	disabled: boolean;
	/** Review first is selected and would replace rules already in the global config. */
	replacesExistingRules: boolean;
	error: string | null;
}) {
	return (
		<div data-qa-id="onboarding-work-style-step" className="flex flex-col gap-4">
			<RadioGroup
				aria-label="Work style"
				value={value}
				onValueChange={(next) => onValueChange(next as WorkStyle)}
				disabled={disabled}
				className="gap-3"
			>
				{WORK_STYLES.map((style) => {
					const copy = CHOICE_COPY[style];
					return (
						<label
							key={style}
							data-qa-id={`onboarding-work-style-${style}`}
							className={cn(
								"bg-foreground/5 hover:bg-foreground/8 has-data-checked:ring-primary-ink flex cursor-pointer items-start gap-3 rounded-2xl p-4 ring-1 ring-transparent transition-[background-color,box-shadow] has-disabled:cursor-not-allowed has-disabled:opacity-60",
							)}
						>
							<RadioGroupItem value={style} className="bg-background mt-0.5" />
							<span className="flex min-w-0 flex-col gap-1">
								<span className="text-sm font-medium">{copy.title}</span>
								<span className="text-muted-foreground text-sm">{copy.description}</span>
								<span className="text-muted-foreground flex items-start gap-1.5 pt-1 text-xs">
									<CheckIcon className="mt-px size-3.5 shrink-0" aria-hidden="true" />
									{copy.detail}
								</span>
							</span>
						</label>
					);
				})}
			</RadioGroup>

			{replacesExistingRules ? (
				<p
					data-qa-id="onboarding-work-style-existing"
					className="text-muted-foreground flex items-start gap-2 text-xs"
				>
					<InfoIcon className="mt-px size-3.5 shrink-0" aria-hidden="true" />
					This replaces the matching permission rules already in your Kilo config.
				</p>
			) : null}

			{error ? <FieldError>{error}</FieldError> : null}
		</div>
	);
}

/**
 * Showcase for the work-style step: the same edit as seen under each style —
 * an approval prompt for Review first, an already-applied change for High
 * autonomy. Follows the selection; Review first until one is made.
 */
export function WorkStyleShowcase({ style }: { style: WorkStyle | null }) {
	const reviewFirst = style !== "autonomous";
	return (
		<div className="flex flex-col items-center gap-8 select-none">
			<div className="bg-background/60 dark:bg-background/40 w-full max-w-80 rounded-2xl p-4 shadow-sm">
				<div className="flex flex-col gap-1.5 pb-3">
					<span className="bg-foreground/12 h-1.5 w-4/5 rounded-full" />
					<span className="bg-foreground/12 h-1.5 w-3/5 rounded-full" />
				</div>
				<AnimatePresence mode="wait" initial={false}>
					<motion.div
						key={reviewFirst ? "ask" : "applied"}
						initial={{ opacity: 0, y: 6 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0, y: -6 }}
						transition={{ duration: 0.2 }}
						className="bg-foreground/5 flex flex-col gap-3 rounded-xl p-3"
					>
						<span className="flex items-center gap-2 text-xs">
							<FilePenIcon className="text-muted-foreground size-3.5 shrink-0" />
							<span className="text-foreground/80 truncate font-mono">src/app.tsx</span>
							{reviewFirst ? null : (
								<span className="text-success ml-auto flex items-center gap-1">
									<CheckIcon className="size-3.5" />
									Edited
								</span>
							)}
						</span>
						<span className="flex flex-col gap-1">
							<span className="h-1.5 w-11/12 rounded-full bg-green-500/50" />
							<span className="h-1.5 w-2/3 rounded-full bg-red-500/50" />
						</span>
						{reviewFirst ? (
							<span className="flex justify-end gap-1.5">
								<span className="bg-foreground/8 rounded-md px-2.5 py-1 text-xs">Deny</span>
								<span className="bg-foreground/20 text-foreground rounded-md px-2.5 py-1 text-xs font-medium">
									Allow
								</span>
							</span>
						) : null}
					</motion.div>
				</AnimatePresence>
			</div>
			<p className="text-muted-foreground text-center text-xs">
				{reviewFirst ? "Kilo asks before it changes anything." : "Fewer interruptions."}
			</p>
		</div>
	);
}
