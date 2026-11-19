import { CircleAlertIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Alert, AlertDescription, AlertTitle } from "@kilo-desktop/ui/components/alert";

export function gitUnavailable(): never {
	throw new Error("Git isn't available.");
}

export function errorMessage(reason: unknown, fallback: string): string {
	return reason instanceof Error && reason.message ? reason.message : fallback;
}

/** Renders `backticked` spans (a command to run) as inline code. */
function withInlineCode(message: string): ReactNode[] {
	return message.split(/(`[^`]+`)/).map((part, index) =>
		part.startsWith("`") && part.endsWith("`") && part.length > 2 ? (
			// Pieces of one fixed message: never reordered, and the same text may repeat.
			// react-doctor-disable-next-line react-doctor/no-array-index-as-key
			<code key={index}>{part.slice(1, -1)}</code>
		) : (
			part
		),
	);
}

/** A failed lookup while choosing what to clone: what failed, then what to do about it. */
export function CloneErrorAlert({ title, message }: { title: string; message: string }) {
	return (
		<Alert variant="destructive">
			<CircleAlertIcon aria-hidden="true" />
			<AlertTitle>{title}</AlertTitle>
			<AlertDescription>{withInlineCode(message)}</AlertDescription>
		</Alert>
	);
}
