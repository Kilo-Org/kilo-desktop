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
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@anaconda-agentic-desktop/ui/components/dialog";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupInput,
	InputGroupTextarea,
} from "@anaconda-agentic-desktop/ui/components/input-group";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@anaconda-agentic-desktop/ui/components/tooltip";
import { cn } from "@anaconda-agentic-desktop/ui/lib/utils";

import {
	LOCAL_API_KEY_MASK,
	localConnectionExamples,
	localConnectionFields,
	type LocalConnectionExample,
} from "./connection-display.js";
import type { LocalConnectionInfo } from "./contract.js";

const METHOD_BADGE_CLASSES = {
	GET: "border-blue-600 bg-blue-600 text-white",
	POST: "border-emerald-700 bg-emerald-700 text-white",
} satisfies Record<LocalConnectionExample["method"], string>;

export function ConnectionInfoDialog({
	connection,
	modelId,
	onCopy,
}: {
	connection: LocalConnectionInfo;
	modelId?: string | undefined;
	onCopy: (text: string) => void;
}) {
	const [copied, setCopied] = useState<string | null>(null);
	const fields = localConnectionFields(connection);
	const examples = localConnectionExamples(connection, modelId);
	const copy = (id: string, value: string) => {
		onCopy(value);
		setCopied(id);
	};

	return (
		<Dialog>
			<Tooltip>
				<TooltipTrigger
					render={
						<DialogTrigger
							render={
								<Button
									type="button"
									variant="ghost"
									size="icon-sm"
									aria-label="Connection information"
									data-qa-id="local-provider-connection"
									onClick={(event) => event.stopPropagation()}
								/>
							}
						/>
					}
				>
					<CableIcon />
				</TooltipTrigger>
				<TooltipContent data-qa-id="local-provider-connection-tooltip">
					Connection information
				</TooltipContent>
			</Tooltip>
			<DialogContent
				className="max-h-[calc(100dvh-2rem)] min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden sm:max-w-xl"
				data-qa-id="local-provider-connection-dialog"
			>
				<DialogHeader>
					<DialogTitle>Connection Information</DialogTitle>
					<DialogDescription>
						The local server is OpenAI-compatible. Use the URLs and examples below to see how to
						connect/use it outside of the app.
					</DialogDescription>
				</DialogHeader>
				<div className="flex min-h-0 min-w-0 flex-col gap-4 overflow-x-hidden overflow-y-auto">
					{fields.map((field) => (
						<CopyValue
							key={field.id}
							id={field.id}
							label={field.label}
							value={field.masked ? LOCAL_API_KEY_MASK : field.value}
							copied={copied === field.id}
							onCopy={() => copy(field.id, field.value)}
						/>
					))}
					<Accordion className="border-border min-w-0 overflow-hidden rounded-lg border">
						{examples.map((example) => (
							<AccordionItem key={example.id} value={example.id} className="min-w-0">
								<AccordionTrigger
									className="hover:bg-foreground/5 grid w-full min-w-0 grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-2 rounded-none px-3 py-2.5 text-left no-underline transition-colors hover:no-underline"
									data-qa-id={`local-provider-connection-endpoint-${example.id}`}
								>
									<Badge
										variant="outline"
										className={cn(
											"w-full justify-center font-mono tabular-nums",
											METHOD_BADGE_CLASSES[example.method],
										)}
									>
										{example.method}
									</Badge>
									<p className="min-w-0 truncate text-sm font-medium">{example.label}</p>
								</AccordionTrigger>
								<AccordionContent className="border-border flex flex-col gap-3 border-t px-3 py-3">
									<CopyValue
										id={`${example.id}-url`}
										label="URL"
										value={example.url}
										copied={copied === `${example.id}-url`}
										onCopy={() => copy(`${example.id}-url`, example.url)}
									/>
									<CopyValue
										id={`${example.id}-curl`}
										label="curl"
										value={example.curlDisplay}
										copied={copied === `${example.id}-curl`}
										multiline
										onCopy={() => copy(`${example.id}-curl`, example.curl)}
									/>
								</AccordionContent>
							</AccordionItem>
						))}
					</Accordion>
				</div>
			</DialogContent>
		</Dialog>
	);
}

function CopyValue({
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
				data-qa-id={`local-provider-connection-copy-${id}`}
				onClick={onCopy}
			>
				{copied ? <CheckIcon /> : <CopyIcon />}
			</InputGroupButton>
		</InputGroupAddon>
	);

	return (
		<div className="flex min-w-0 flex-col gap-1">
			<p className="text-xs font-medium">{label}</p>
			<InputGroup className="min-w-0 overflow-hidden">
				{multiline ? (
					<InputGroupTextarea
						readOnly
						rows={3}
						value={value}
						className="min-w-0 font-mono text-xs leading-snug"
						data-qa-id={`local-provider-connection-${id}`}
					/>
				) : (
					<InputGroupInput
						readOnly
						value={value}
						className="min-w-0 font-mono text-xs"
						data-qa-id={`local-provider-connection-${id}`}
					/>
				)}
				{copyButton}
			</InputGroup>
		</div>
	);
}
