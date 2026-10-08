import type { ReactNode } from "react";
import { ShieldAlertIcon } from "lucide-react";

import type { McpConfigPreview } from "./mcp-config-preview.js";
import { Alert, AlertTitle } from "@kilo-desktop/ui/components/alert";

const CODE_CLASS =
	"bg-muted/50 text-foreground block min-w-0 rounded-md border px-2 py-1.5 font-mono text-xs whitespace-pre-wrap [overflow-wrap:anywhere]";

const WARNINGS: Record<McpConfigPreview["kind"], { title: string; description: string }> = {
	local: {
		title: "This MCP is started via a command on your computer",
		description:
			"Kilo starts it with your user’s permissions, so it can access your files and network. Only install it if you trust the source.",
	},
	remote: {
		title: "This MCP connects to an external server",
		description:
			"Kilo sends this server your requests and whatever its tools are given, which can include your code and files. Only install it if you trust the source.",
	},
	raw: {
		title: "This MCP adds custom configuration",
		description: "Kilo adds this to its MCP settings. Only install it if you trust the source.",
	},
};

/**
 * The exact MCP entry an install will write, shown before the user confirms. Catalog names,
 * descriptions, and method labels are author-supplied, so this is the only part of the dialog
 * that reliably says what will run or where data goes — every kind is styled as a warning so it
 * is read, not skimmed.
 */
export function McpConfigReview({ preview }: { preview: McpConfigPreview }) {
	const { title, description } = WARNINGS[preview.kind];
	return (
		<Alert variant="destructive" data-qa-id="marketplace-install-config">
			<ShieldAlertIcon aria-hidden="true" />
			<AlertTitle>{title}</AlertTitle>
			{/* Not AlertDescription: the destructive variant tints that slot red; only the title warns. */}
			<p className="text-card-foreground col-start-2 mt-1.5 text-sm text-pretty">{description}</p>
			<ReviewDetails>
				{preview.kind === "local" ? (
					<>
						<ReviewBlock label="Command" qaId="marketplace-install-command">
							{preview.commandLine}
						</ReviewBlock>
						<NamedValues label="Environment" separator="=" values={preview.environment} />
					</>
				) : preview.kind === "remote" ? (
					<>
						<ReviewBlock label="Address" qaId="marketplace-install-endpoint">
							{preview.url}
						</ReviewBlock>
						<NamedValues label="Headers" separator=": " values={preview.headers} />
					</>
				) : (
					<ReviewBlock label="Configuration" qaId="marketplace-install-config-raw">
						{preview.text}
					</ReviewBlock>
				)}
			</ReviewDetails>
		</Alert>
	);
}

function ReviewDetails({ children }: { children: ReactNode }) {
	return <div className="col-start-2 mt-1.5 grid min-w-0 gap-3">{children}</div>;
}

function ReviewBlock({
	label,
	qaId,
	children,
}: {
	label: string;
	qaId?: string;
	children: ReactNode;
}) {
	return (
		<div className="grid min-w-0 gap-1.5">
			<p className="text-muted-foreground text-xs font-medium">{label}</p>
			<code className={CODE_CLASS} data-qa-id={qaId}>
				{children}
			</code>
		</div>
	);
}

function NamedValues({
	label,
	separator,
	values,
}: {
	label: string;
	separator: string;
	values: ReadonlyArray<[string, string]>;
}) {
	if (values.length === 0) return null;
	return (
		<ReviewBlock label={label}>
			{values.map(([name, value]) => `${name}${separator}${value}`).join("\n")}
		</ReviewBlock>
	);
}
