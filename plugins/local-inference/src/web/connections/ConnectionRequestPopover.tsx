import { useState } from "react";
import { CableIcon, CheckIcon, CopyIcon } from "lucide-react";

import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@anaconda-agentic-desktop/ui/components/accordion";
import { Badge } from "@anaconda-agentic-desktop/ui/components/badge";
import { Button } from "@anaconda-agentic-desktop/ui/components/button";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupInput,
	InputGroupTextarea,
} from "@anaconda-agentic-desktop/ui/components/input-group";
import {
	Popover,
	PopoverContent,
	PopoverDescription,
	PopoverHeader,
	PopoverTitle,
	PopoverTrigger,
} from "@anaconda-agentic-desktop/ui/components/popover";
import { cn } from "@anaconda-agentic-desktop/ui/lib/utils";

import type { LocalConnectionInfo } from "../../contracts/schemas.js";
import { localConnectionRequests, type LocalConnectionRequest } from "./connection-requests.js";

const METHOD_BADGE_CLASSES = {
	GET: "border-blue-600 bg-blue-600 text-white",
	POST: "border-emerald-700 bg-emerald-700 text-white",
} satisfies Record<LocalConnectionRequest["method"], string>;

export function ConnectionRequestPopover({
	connection,
	modelId,
	onCopy,
}: {
	connection: LocalConnectionInfo | undefined;
	modelId?: string | undefined;
	onCopy: (value: string) => void;
}) {
	const [copiedId, setCopiedId] = useState<string>();
	const requests = connection ? localConnectionRequests(connection, modelId) : [];
	const copy = (id: string, value: string) => {
		onCopy(value);
		setCopiedId(id);
	};

	return (
		<Popover>
			<PopoverTrigger
				render={
					<Button
						type="button"
						variant="ghost"
						size="xs"
						disabled={!connection}
						aria-label="Request info"
						data-qa-id="local-model-server-request-info-trigger"
					/>
				}
			>
				<CableIcon data-icon="inline-start" aria-hidden />
				Request info
			</PopoverTrigger>
			<PopoverContent
				align="end"
				sideOffset={8}
				className="max-h-[min(36rem,calc(100dvh-2rem))] w-[min(32rem,calc(100vw-2rem))] gap-3 overflow-y-auto p-3"
				data-qa-id="local-model-server-request-info"
			>
				<PopoverHeader>
					<PopoverTitle className="text-sm">Request information</PopoverTitle>
					<PopoverDescription className="text-xs leading-relaxed">
						Use these OpenAI-compatible endpoints to send requests from outside the app.
					</PopoverDescription>
				</PopoverHeader>
				<Accordion className="border-border min-w-0 overflow-hidden rounded-lg border">
					{requests.map((request) => (
						<AccordionItem key={request.id} value={request.id} className="min-w-0">
							<AccordionTrigger
								className="hover:bg-foreground/5 grid w-full min-w-0 grid-cols-[3.25rem_minmax(0,1fr)_auto] items-center gap-2 rounded-none px-3 py-2.5 text-left no-underline transition-colors hover:no-underline"
								data-qa-id={`local-model-server-request-${request.id}`}
							>
								<Badge
									variant="outline"
									className={cn(
										"h-4.5 w-full justify-center px-1 font-mono text-[11px] leading-none tabular-nums",
										METHOD_BADGE_CLASSES[request.method],
									)}
								>
									{request.method}
								</Badge>
								<span className="min-w-0 truncate text-[13px] font-medium">{request.label}</span>
							</AccordionTrigger>
							<AccordionContent className="border-border flex flex-col gap-3 border-t px-3 py-3">
								<CopyRequestValue
									id={`${request.id}-url`}
									label={`${request.label} URL`}
									value={request.url}
									copied={copiedId === `${request.id}-url`}
									onCopy={() => copy(`${request.id}-url`, request.url)}
								/>
								<CopyRequestValue
									id={`${request.id}-curl`}
									label={`${request.label} curl`}
									value={request.curlDisplay}
									copied={copiedId === `${request.id}-curl`}
									multiline
									onCopy={() => copy(`${request.id}-curl`, request.curl)}
								/>
							</AccordionContent>
						</AccordionItem>
					))}
				</Accordion>
			</PopoverContent>
		</Popover>
	);
}

function CopyRequestValue({
	id,
	label,
	value,
	copied,
	multiline = false,
	onCopy,
}: {
	id: string;
	label: string;
	value: string;
	copied: boolean;
	multiline?: boolean;
	onCopy: () => void;
}) {
	const copyButton = (
		<InputGroupAddon align="inline-end">
			<InputGroupButton
				size="icon-xs"
				aria-label={`Copy ${label}`}
				data-qa-id={`local-model-server-request-copy-${id}`}
				onClick={onCopy}
			>
				{copied ? <CheckIcon /> : <CopyIcon />}
			</InputGroupButton>
		</InputGroupAddon>
	);

	return (
		<div className="flex min-w-0 flex-col gap-1">
			<label htmlFor={`local-model-server-request-${id}`} className="text-xs font-medium">
				{label.endsWith("curl") ? "curl" : "URL"}
			</label>
			<InputGroup className="min-w-0 overflow-hidden">
				{multiline ? (
					<InputGroupTextarea
						id={`local-model-server-request-${id}`}
						readOnly
						rows={3}
						value={value}
						aria-label={label}
						className="min-w-0 font-mono text-xs leading-snug"
					/>
				) : (
					<InputGroupInput
						id={`local-model-server-request-${id}`}
						readOnly
						value={value}
						aria-label={label}
						className="min-w-0 font-mono text-xs"
					/>
				)}
				{copyButton}
			</InputGroup>
		</div>
	);
}
