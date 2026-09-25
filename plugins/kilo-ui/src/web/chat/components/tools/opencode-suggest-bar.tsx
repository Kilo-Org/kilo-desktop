import { useState } from "react";
import { CircleAlertIcon, LightbulbIcon, XIcon } from "lucide-react";

import { Spinner } from "@kilo-desktop/ui/components/spinner";
import { Button } from "@kilo-desktop/ui/components/button";

import { useKiloSuggestionActions } from "../../suggestions/KiloSuggestionContext.js";
import type { KiloSuggestionRequest } from "../../suggestions/kilo-suggestion-logic.js";
import { ComposerShell } from "../composer-shelf.js";

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
			setError(err instanceof Error ? err.message : "Could not respond to the suggestion.");
			setSubmitting(null);
		}
	};

	const isBusy = submitting !== null;

	return (
		<ComposerShell data-qa-id="kilo-suggest-bar" className="gap-3 p-3">
			<div className="flex min-w-0 items-start gap-3">
				<div className="text-muted-foreground mt-0.5 flex min-w-0 flex-1 items-start gap-2 text-sm">
					<LightbulbIcon className="text-warning size-4 shrink-0" />
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
					{submitting === "dismiss" ? <Spinner /> : <XIcon />}
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
						{submitting === index ? <Spinner data-icon="inline-start" aria-hidden="true" /> : null}
						{action.label}
					</Button>
				))}
			</div>
			{error ? (
				<div className="text-destructive flex min-w-0 items-center gap-2 text-xs">
					<CircleAlertIcon className="size-3.5 shrink-0" />
					<span className="truncate">{error}</span>
				</div>
			) : null}
		</ComposerShell>
	);
};
