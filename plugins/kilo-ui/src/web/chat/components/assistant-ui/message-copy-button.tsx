"use client";

import { useActionBarCopy } from "@assistant-ui/core/react";
import { AuiIf } from "@assistant-ui/react";
import { CheckIcon, CopyIcon } from "lucide-react";
import type { FC } from "react";

import { TooltipIconButton } from "./tooltip-icon-button.js";
import { useShellCopyText } from "./use-shell-copy-text.js";

export const MessageCopyButton: FC = () => {
	const copyToClipboard = useShellCopyText();
	const { copy, disabled } = useActionBarCopy({ copyToClipboard });

	return (
		<TooltipIconButton tooltip="Copy" disabled={disabled} onClick={copy}>
			<AuiIf condition={(s) => s.message.isCopied}>
				<CheckIcon className="animate-in zoom-in-50 fade-in size-3.5 duration-200 ease-out" />
			</AuiIf>
			<AuiIf condition={(s) => !s.message.isCopied}>
				<CopyIcon className="animate-in zoom-in-75 fade-in size-3.5 duration-150" />
			</AuiIf>
		</TooltipIconButton>
	);
};
