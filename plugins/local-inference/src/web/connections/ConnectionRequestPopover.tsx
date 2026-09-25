import { useState } from "react";
import { CableIcon, CheckIcon, CopyIcon } from "lucide-react";

import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@kilo-desktop/ui/components/accordion";
import { Button } from "@kilo-desktop/ui/components/button";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupInput,
	InputGroupTextarea,
} from "@kilo-desktop/ui/components/input-group";
import {
	Popover,
	PopoverContent,
	PopoverDescription,
	PopoverHeader,
	PopoverTitle,
	PopoverTrigger,
} from "@kilo-desktop/ui/components/popover";

import type { LocalConnectionInfo } from "../../contracts/schemas.js";
import { localConnectionRequests } from "./connection-requests.js";

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
				className="max-h-[min(36rem,calc(100dvh-2rem))] w-[min(32rem,calc(100vw-2rem))] p-3"
				data-qa-id="local-model-server-request-info"
			>
				<div className="scroll-fade-y -m-3 flex min-h-0 flex-col gap-3 overflow-y-auto p-3">
					<PopoverHeader>
						<PopoverTitle className="text-sm">Request information</PopoverTitle>
						<PopoverDescription className="text-xs leading-relaxed">
							Use these OpenAI-compatible endpoints to send requests from outside the app.
						</PopoverDescription>
					</PopoverHeader>
					<Accordion className="-mx-1.5 w-auto min-w-0 gap-0.5">
						{requests.map((request) => (
							<AccordionItem key={request.id} value={request.id} className="min-w-0 border-none">
								<AccordionTrigger
									className="hover:bg-muted aria-expanded:bg-muted/60 w-full min-w-0 items-center gap-3 rounded-md px-1.5 py-1.5 text-left transition-colors hover:no-underline"
									data-qa-id={`local-model-server-request-${request.id}`}
								>
									<span className="min-w-0 flex-1 truncate text-sm font-medium">
										{request.label}
									</span>
									<span className="text-muted-foreground text-2xs shrink-0 font-mono tracking-tight">
										{request.method} {new URL(request.url).pathname}
									</span>
								</AccordionTrigger>
								<AccordionContent className="flex flex-col gap-3 px-1.5 pt-2 pb-3">
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
				</div>
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
		<div className="flex min-w-0 flex-col gap-1.5">
			<label
				htmlFor={`local-model-server-request-${id}`}
				className="text-muted-foreground text-xs font-medium"
			>
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
