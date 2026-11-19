import { CircleAlertIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Alert, AlertDescription, AlertTitle } from "@kilo-desktop/ui/components/alert";

/** Renders `backticked` spans (a command to run) as inline code. */
function withInlineCode(message: string): ReactNode[] {
	return message
		.split(/(`[^`]+`)/)
		.map((part, index) =>
			part.startsWith("`") && part.endsWith("`") && part.length > 2 ? (
				<code key={index}>{part.slice(1, -1)}</code>
			) : (
				part
			),
		);
}

export function errorMessage(reason: unknown, fallback: string): string {
	return reason instanceof Error && reason.message ? reason.message : fallback;
}

/** A failed step of creating a workspace: what failed, then what to do about it. */
export function WorkspaceErrorAlert({ title, message }: { title: string; message: string }) {
	return (
		<Alert variant="destructive">
			<CircleAlertIcon aria-hidden="true" />
			<AlertTitle>{title}</AlertTitle>
			<AlertDescription>{withInlineCode(message)}</AlertDescription>
		</Alert>
	);
}
