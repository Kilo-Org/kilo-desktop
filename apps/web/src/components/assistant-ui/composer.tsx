"use client";

import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { Button } from "@anaconda-agentic-desktop/ui/components/button";
import { AuiIf, ComposerPrimitive } from "@assistant-ui/react";
import { ArrowUpIcon, SquareIcon } from "lucide-react";
import type { CSSProperties, FC, ReactNode } from "react";

const composerStyle = {
	["--composer-bg" as string]:
		"color-mix(in oklab, var(--color-muted) 30%, var(--color-background))",
	["--composer-radius" as string]: "1.5rem",
	["--composer-padding" as string]: "8px",
} as CSSProperties;

export const Composer: FC<{ leadingAction?: ReactNode }> = ({ leadingAction }) => {
	return (
		<ComposerPrimitive.Root
			className="aui-composer-root relative flex w-full flex-col"
			style={composerStyle}
		>
			<div
				data-slot="aui_composer-shell"
				className="border-border/60 focus-within:border-border dark:border-muted-foreground/15 dark:focus-within:border-muted-foreground/30 flex w-full flex-col gap-2 rounded-(--composer-radius) border bg-(--composer-bg) p-(--composer-padding) shadow-[0_4px_16px_-8px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.04)] transition-[border-color,box-shadow] focus-within:shadow-[0_6px_24px_-8px_rgba(0,0,0,0.12),0_1px_2px_rgba(0,0,0,0.05)] dark:shadow-none"
			>
				<ComposerPrimitive.Input
					placeholder="Send a message..."
					className="aui-composer-input caret-primary placeholder:text-muted-foreground/80 max-h-32 min-h-10 w-full resize-none bg-transparent px-2.5 py-1 text-base outline-none"
					rows={1}
					autoFocus
					enterKeyHint="send"
					aria-label="Message input"
				/>
				<ComposerAction leadingAction={leadingAction} />
			</div>
		</ComposerPrimitive.Root>
	);
};

const ComposerAction: FC<{ leadingAction?: ReactNode }> = ({ leadingAction }) => {
	return (
		<div className="aui-composer-action-wrapper relative flex items-center justify-between gap-2">
			<div className="min-w-0">{leadingAction}</div>
			<div className="flex items-center">
				<AuiIf condition={(s) => !s.thread.isRunning}>
					<ComposerPrimitive.Send
						render={
							<TooltipIconButton
								tooltip="Send message"
								side="bottom"
								type="button"
								variant="default"
								size="icon"
								className="aui-composer-send size-7 rounded-full"
								aria-label="Send message"
							/>
						}
					>
						<ArrowUpIcon className="aui-composer-send-icon size-4.5" />
					</ComposerPrimitive.Send>
				</AuiIf>
				<AuiIf condition={(s) => s.thread.isRunning}>
					<ComposerPrimitive.Cancel
						render={
							<Button
								type="button"
								variant="default"
								size="icon"
								className="aui-composer-cancel size-7 rounded-full"
								aria-label="Stop generating"
							/>
						}
					>
						<SquareIcon className="aui-composer-cancel-icon size-3.5 fill-current" />
					</ComposerPrimitive.Cancel>
				</AuiIf>
			</div>
		</div>
	);
};
