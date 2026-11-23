import { ChevronRightIcon } from "lucide-react";
import { Fragment, type ReactNode } from "react";

import { cn } from "@kilo-desktop/ui/lib/utils";

export interface Choice {
	readonly label: string;
	/** Drawn at size-3.5. */
	readonly icon?: ReactNode;
	readonly changeLabel: string;
	readonly onChange: () => void;
	readonly qaId?: string;
}

/**
 * The choices made so far while setting up a workspace, as one compact line
 * (`GitHub repository › owner/name`); clicking one makes that choice again.
 */
export function ChoicesLine({
	choices,
	appearance,
}: {
	choices: readonly Choice[];
	appearance: "outlined" | "filled";
}) {
	return (
		<nav aria-label="Choices" className="flex min-w-0 flex-wrap items-center gap-1">
			{choices.map(({ label, icon, changeLabel, onChange, qaId }, index) => (
				<Fragment key={changeLabel}>
					{index > 0 ? (
						<ChevronRightIcon
							className="text-muted-foreground size-3.5 shrink-0"
							aria-hidden="true"
						/>
					) : null}
					<button
						type="button"
						aria-label={changeLabel}
						title={changeLabel}
						data-qa-id={qaId}
						onClick={onChange}
						className={cn(
							"focus-visible:ring-ring/50 flex h-7 min-w-0 items-center gap-1.5 rounded-lg px-2 text-sm transition-colors outline-none focus-visible:ring-3",
							appearance === "filled"
								? "bg-foreground/5 hover:bg-foreground/10"
								: "bg-muted hover:bg-muted/70",
						)}
					>
						{icon ? (
							<span className="text-muted-foreground flex shrink-0" aria-hidden="true">
								{icon}
							</span>
						) : null}
						<span className="truncate">{label}</span>
					</button>
				</Fragment>
			))}
		</nav>
	);
}
