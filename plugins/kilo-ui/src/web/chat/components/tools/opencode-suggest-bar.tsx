import { useState } from "react";
import { AlertCircleIcon, LightbulbIcon, LoaderIcon, XIcon } from "lucide-react";

import { Button } from "@kilo-desktop/ui/components/button";
import { cn } from "@kilo-desktop/ui/lib/utils";

import { useKiloSuggestionActions } from "../../suggestions/KiloSuggestionContext.js";
import type { KiloSuggestionRequest } from "../../suggestions/kilo-suggestion-logic.js";

export const OpenCodeSuggestBar = ({ request }: { request: KiloSuggestionRequest }) => {
	const { accept, dismiss } = useKiloSuggestionActions();
	const [submitting, setSubmitting] = useState<"accept" | "dismiss" | number | null>(null);
	const [error, setError] = useState<string | null>(null);

	const run = async (kind: "accept" | "dismiss" | number, action: () => Promise<void>) => {
		if (submitting !== null) return;
		setSubmitting(kind);
		setError(null);
		try {
			await action();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to respond to the suggestion.");
			setSubmitting(null);
		}
	};

	const isBusy = submitting !== null;

	return (
		<div
			data-slot="aui_composer-shell"
			data-qa-id="kilo-suggest-bar"
			className={cn(
				"border-border dark:border-muted-foreground/15 chat-composer-glass chat-composer-surface flex w-full flex-col gap-3 rounded-(--composer-radius) border p-3 shadow-[0_12px_28px_-18px_rgba(0,0,0,0.40)] dark:shadow-none",
			)}
		>
			<div className="flex min-w-0 items-start gap-3">
				<div className="text-muted-foreground mt-0.5 flex min-w-0 flex-1 items-start gap-2 text-sm">
					<LightbulbIcon className="size-4 shrink-0 text-amber-700 dark:text-amber-500" />
					<p className="min-w-0 text-pretty">{request.text}</p>
				</div>
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					aria-label="Dismiss suggestion"
					disabled={isBusy}
					onClick={() => void run("dismiss", () => dismiss(request))}
				>
					{submitting === "dismiss" ? <LoaderIcon className="animate-spin" /> : <XIcon />}
				</Button>
			</div>
			<div className="flex flex-wrap items-center justify-end gap-2">
				{request.actions.map((action, index) => (
					<Button
						key={`${action.label}-${index}`}
						type="button"
						size="sm"
						disabled={isBusy}
						aria-description={action.description}
						onClick={() => void run(index, () => accept(request, index))}
					>
						{submitting === index ? (
							<LoaderIcon className="animate-spin" data-icon="inline-start" />
						) : null}
						{action.label}
					</Button>
				))}
			</div>
			{error ? (
				<div className="text-destructive-foreground flex min-w-0 items-center gap-2 text-xs">
					<AlertCircleIcon className="size-3.5 shrink-0" />
					<span className="truncate">{error}</span>
				</div>
			) : null}
		</div>
	);
};
