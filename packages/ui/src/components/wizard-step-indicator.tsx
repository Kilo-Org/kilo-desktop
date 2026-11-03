import { cn } from "@kilo-desktop/ui/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@kilo-desktop/ui/components/tooltip";

export type WizardStep<T extends string> = {
	id: T;
	label: string;
};

export function WizardStepIndicator<T extends string>({
	steps,
	currentStep,
	busy = false,
	qaPrefix,
	canSelect = () => true,
	showCount = true,
	onSelect,
}: {
	steps: readonly WizardStep<T>[];
	currentStep: T;
	busy?: boolean;
	qaPrefix: string;
	canSelect?: (step: T) => boolean;
	/** Visible "1 of 3" beside the bars; when false it stays for screen readers only. */
	showCount?: boolean;
	onSelect: (step: T) => void;
}) {
	const stepIndex = steps.findIndex(({ id }) => id === currentStep);

	return (
		<div className="flex items-center gap-2">
			{steps.map(({ id, label }, index) => {
				const isActive = index === stepIndex;
				const isDone = index < stepIndex;
				return (
					<Tooltip key={id}>
						<TooltipTrigger
							render={
								<button
									type="button"
									data-qa-id={`${qaPrefix}-progress-${id}`}
									aria-label={`Go to step ${index + 1}: ${label}`}
									aria-current={isActive ? "step" : undefined}
									disabled={busy || !canSelect(id)}
									onClick={() => onSelect(id)}
									className={cn(
										"relative h-1 rounded-full outline-none transition-all duration-300 before:absolute before:-inset-y-2 before:-inset-x-1 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:pointer-events-none disabled:opacity-50",
										isActive
											? "bg-foreground w-10"
											: isDone
												? "bg-muted-foreground/70 hover:bg-foreground/80 w-6"
												: "bg-muted-foreground/25 hover:bg-muted-foreground/45 w-6",
									)}
								/>
							}
						/>
						<TooltipContent side="top" sideOffset={8}>
							{label}
						</TooltipContent>
					</Tooltip>
				);
			})}
			<span
				className={showCount ? "text-muted-foreground ml-3 text-xs font-medium" : "sr-only"}
				data-qa-id={`${qaPrefix}-progress-label`}
			>
				{showCount ? null : "Step "}
				{stepIndex + 1} of {steps.length}
			</span>
		</div>
	);
}
