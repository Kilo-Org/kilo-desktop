import { useAui, useAuiState } from "@assistant-ui/react";
import { PlusIcon } from "lucide-react";

import type {
	ComposerActionButton,
	ComposerActionImplementation,
	ComposerActionStateProps,
} from "../../contracts";
import { agentAction } from "../selection/kilo-agent-selector";
import { approvalAction } from "../selection/kilo-approval-selector";
import { KiloModelSelectorContent, KiloModelTrigger } from "../selection/kilo-model-selector";
import {
	unavailableFoldersDraftAction,
	unavailableFoldersFooterAction,
} from "./unavailable-folders";

/** Opens the file picker and adds the chosen files to the composer, as assistant-ui's button does. */
function AttachButton({ children }: ComposerActionStateProps<ComposerActionButton>) {
	const aui = useAui();
	const editing = useAuiState((s) => s.composer.isEditing);
	return children({
		icon: PlusIcon,
		tooltip: "Add attachment",
		disabled: !editing,
		run: () => {
			const input = document.createElement("input");
			input.type = "file";
			input.multiple = true;
			input.hidden = true;
			const accept = aui.composer.getState().attachmentAccept;
			if (accept !== "*") input.accept = accept;
			document.body.appendChild(input);
			input.onchange = () => {
				const files = Array.from(input.files ?? []);
				input.remove();
				for (const file of files) {
					void aui.composer.addAttachment(file).catch(() => undefined);
				}
			};
			input.oncancel = () => input.remove();
			input.click();
		},
	});
}

/**
 * kilo.chat's own composer controls, shipped through its `composer-action`
 * point like anyone's (their manifest entries give slot, kind and order).
 */
export const BUILTIN_COMPOSER_ACTIONS: Readonly<Record<string, ComposerActionImplementation>> = {
	attach: { kind: "action", Button: AttachButton },
	agent: agentAction,
	model: { kind: "popover", Trigger: KiloModelTrigger, Content: KiloModelSelectorContent },
	approval: approvalAction,
	"unavailable-folders": unavailableFoldersFooterAction,
	"unavailable-folders-draft": unavailableFoldersDraftAction,
};
