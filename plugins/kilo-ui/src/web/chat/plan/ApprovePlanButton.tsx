import { CheckIcon, Loader2Icon } from "lucide-react";
import type { FC } from "react";

import { Button } from "@anaconda-agentic-desktop/ui/components/button";
import { cn } from "@anaconda-agentic-desktop/ui/lib/utils";

type ApprovePlanButtonProps = {
	enabled: boolean;
	approve: () => void;
	submitting: boolean;
	approved: boolean;
	className?: string;
	approveQaId?: string;
	approvedQaId?: string;
};

/** Shared Approve / Approved control for the plan card and plan pane. */
export const ApprovePlanButton: FC<ApprovePlanButtonProps> = ({
	enabled,
	approve,
	submitting,
	approved,
	className,
	approveQaId = "kilo-plan-approve",
	approvedQaId = "kilo-plan-approved",
}) => {
	if (!enabled) return null;

	if (approved) {
		return (
			<span
				role="status"
				data-qa-id={approvedQaId}
				className={cn(
					"inline-flex h-7 shrink-0 items-center gap-1 rounded-lg bg-emerald-500/15 px-2.5 text-[0.8rem] font-medium text-emerald-600 dark:text-emerald-400",
					className,
				)}
			>
				Approved
			</span>
		);
	}

	return (
		<Button
			type="button"
			size="sm"
			data-qa-id={approveQaId}
			disabled={submitting}
			className={className}
			onClick={approve}
		>
			{submitting ? (
				<Loader2Icon className="size-4 animate-spin" />
			) : (
				<CheckIcon className="size-4" />
			)}
			Approve
		</Button>
	);
};
