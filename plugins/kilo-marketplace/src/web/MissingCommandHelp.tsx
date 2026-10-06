import { useState } from "react";
import {
	CheckIcon,
	CircleAlertIcon,
	CopyIcon,
	ExternalLinkIcon,
	MessageSquareIcon,
	WrenchIcon,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { mcpRuntime } from "../contracts/runtimes.js";
import type { MarketplaceService, MissingMcpCommand } from "../contracts/schemas.js";
import { fixMissingCommandPrompt, installAdvice, missingCommandMessage } from "./mcp-commands.js";
import { sdkQueryOptions, useSdk } from "@kilo-desktop/sdk-react";
import { Alert, AlertDescription, AlertTitle } from "@kilo-desktop/ui/components/alert";
import { Button, buttonVariants } from "@kilo-desktop/ui/components/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@kilo-desktop/ui/components/dialog";
import { ExternalLink } from "@kilo-desktop/ui/components/external-link";
import { Tooltip, TooltipContent, TooltipTrigger } from "@kilo-desktop/ui/components/tooltip";

/** Structural shape of kilo-ui's `chatComposer` capability — asserted, not imported. */
type KiloUiChatComposer = {
	chatComposer?: { startNewChat(input: { text: string }): Promise<void> };
};

const COPIED_FEEDBACK_MS = 2000;

/** Whether `command` is missing from the PATH Kilo spawns MCPs with, plus how to install it here. */
export function useMissingCommand(command: string | undefined): MissingMcpCommand | undefined {
	const sdk = useSdk<MarketplaceService>("kilo-marketplace");
	const check = useQuery({
		...sdkQueryOptions(sdk, "marketplace.checkCommands", { commands: command ? [command] : [] }),
		enabled: command !== undefined,
	});
	return check.data?.missing.find((entry) => entry.command === command);
}

/**
 * Install-dialog warning for a method whose launch command is missing:
 * copyable install commands for this OS, the runtime's installation guide, and
 * a Fix-in-chat draft when kilo-ui is loaded. Nothing runs without the user.
 */
export function MissingCommandAlert({
	missing,
	onFixInChat,
}: {
	missing: MissingMcpCommand;
	/** Runs before the chat opens, e.g. to close the dialog that would otherwise cover it. */
	onFixInChat: () => void;
}) {
	return (
		<Alert variant="destructive" data-qa-id="marketplace-install-missing-command">
			<CircleAlertIcon aria-hidden="true" />
			<AlertTitle>This MCP server won't start yet</AlertTitle>
			<AlertDescription>{missingCommandMessage(missing.command)}</AlertDescription>
			<div className="col-start-2 mt-2 grid min-w-0 gap-2">
				<InstallCommandList commands={missing.installCommands} />
				<div className="flex flex-wrap gap-1.5">
					<MissingCommandActions command={missing.command} onFixInChat={onFixInChat} />
				</div>
			</div>
		</Alert>
	);
}

/**
 * "Fix" action for an installed MCP location whose launch command is missing.
 * Keeps the location row to one line by moving the instructions into a dialog.
 */
export function MissingCommandFix({ command, qaId }: { command: string; qaId: string }) {
	const installCommands = useMissingCommand(command)?.installCommands ?? [];
	const [open, setOpen] = useState(false);

	return (
		<>
			<Button
				type="button"
				variant="destructive"
				size="xs"
				className="shrink-0"
				onClick={() => setOpen(true)}
				data-qa-id={qaId}
			>
				<WrenchIcon data-icon="inline-start" aria-hidden />
				Fix
			</Button>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent className="sm:max-w-lg">
					<DialogHeader>
						<DialogTitle>{command} was not found</DialogTitle>
						<DialogDescription>
							Kilo Desktop needs {command} to start this MCP server. {installAdvice(command)}
						</DialogDescription>
					</DialogHeader>
					{installCommands.length > 0 ? (
						<div className="grid min-w-0 gap-2">
							<p className="text-muted-foreground text-sm">Run this in a terminal:</p>
							<InstallCommandList commands={installCommands} />
						</div>
					) : null}
					<DialogFooter>
						<DialogClose render={<Button variant="outline" />}>Close</DialogClose>
						<MissingCommandActions
							command={command}
							size="default"
							onFixInChat={() => setOpen(false)}
						/>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}

function MissingCommandActions({
	command,
	size = "xs",
	onFixInChat,
}: {
	command: string;
	size?: "xs" | "default";
	onFixInChat: () => void;
}) {
	const sdk = useSdk<MarketplaceService>("kilo-marketplace");
	const chat = sdk.plugins.get<KiloUiChatComposer>("kilo-ui")?.chatComposer;
	const runtime = mcpRuntime(command);

	return (
		<>
			{runtime ? (
				<ExternalLink
					href={runtime.installUrl}
					onOpen={(url) => void sdk.shell.openExternal(url)}
					className={buttonVariants({ variant: "outline", size })}
				>
					Installation
					<ExternalLinkIcon data-icon="inline-end" aria-hidden />
				</ExternalLink>
			) : null}
			{chat ? (
				<Button
					type="button"
					variant={size === "default" ? "default" : "outline"}
					size={size}
					onClick={() => {
						onFixInChat();
						void chat.startNewChat({ text: fixMissingCommandPrompt(command) });
					}}
				>
					<MessageSquareIcon data-icon="inline-start" aria-hidden />
					Fix in chat
				</Button>
			) : null}
		</>
	);
}

function InstallCommandList({ commands }: { commands: readonly string[] }) {
	return commands.map((command) => <InstallCommand key={command} command={command} />);
}

function InstallCommand({ command }: { command: string }) {
	const sdk = useSdk<MarketplaceService>("kilo-marketplace");
	const [copied, setCopied] = useState(false);
	const copy = () => {
		void sdk.shell.copyText(command).then(
			() => {
				setCopied(true);
				setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
			},
			() => undefined,
		);
	};

	return (
		<div className="bg-muted/50 text-foreground flex min-w-0 items-center gap-1 rounded-md border py-1 pr-1 pl-2">
			<code className="min-w-0 flex-1 font-mono text-xs [overflow-wrap:anywhere]">{command}</code>
			<Tooltip>
				<TooltipTrigger
					render={
						<Button
							type="button"
							variant="ghost"
							size="icon-xs"
							aria-label={copied ? "Copied" : `Copy ${command}`}
							onClick={copy}
						/>
					}
				>
					{copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
				</TooltipTrigger>
				<TooltipContent>{copied ? "Copied" : "Copy command"}</TooltipContent>
			</Tooltip>
		</div>
	);
}
