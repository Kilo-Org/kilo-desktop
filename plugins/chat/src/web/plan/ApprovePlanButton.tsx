import { CheckIcon } from "lucide-react";
import type { FC } from "react";

import { Spinner } from "@kilo-desktop/ui/components/spinner";
import { Button } from "@kilo-desktop/ui/components/button";
import { cn } from "@kilo-desktop/ui/lib/utils";

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
					"inline-flex h-7 shrink-0 items-center gap-1 rounded-lg bg-success-surface px-2.5 text-[0.8rem] font-medium text-success-foreground",
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
				<Spinner data-icon="inline-start" aria-hidden="true" />
			) : (
				<CheckIcon data-icon="inline-start" />
			)}
			{submitting ? "Approving…" : "Approve"}
		</Button>
	);
};
