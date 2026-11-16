import { ComposerPrimitive, MessagePrimitive } from "@assistant-ui/react";
import type { FC } from "react";

import { Button } from "@kilo-desktop/ui/components/button";

import { KiloLexicalComposerInput } from "../composer/kilo-lexical-composer-input";
import { KiloSlashTrigger } from "../composer/kilo-slash-trigger";
import { MentionIconsContext, MentionTriggers } from "../composer/mention-triggers";
import { useComposerInputWiring } from "../composer/use-composer-input-wiring";
import { ComposerAttachments } from "./attachment";

/**
 * A sent prompt being edited, in place of its bubble: the message's own edit
 * composer, with the main composer's chips, `/` and mention menus and
 * attachments, but no queue or client commands. Saving sends the edit
 * through the runtime's `onEdit`, which reverts to this prompt first.
 */
export const UserEditComposer: FC = () => {
	const { slash, sources, formatter, placeholder, icons, mentionContext } = useComposerInputWiring({
		promptCommandsOnly: true,
	});
	return (
		<MentionIconsContext.Provider value={icons}>
			<MessagePrimitive.Root
				data-slot="aui_user-edit-composer-root"
				data-role="user"
				className="flex flex-col px-2 pb-7"
			>
				<ComposerPrimitive.Unstable_TriggerPopoverRoot>
					<ComposerPrimitive.Root
						data-qa-id="kilo-edit-message-composer"
						className="bg-pane-raised border-border-subtle focus-within:border-ring flex w-full flex-col gap-2 rounded-xl border px-3 pt-2 pb-2 transition-colors"
					>
						<ComposerAttachments />
						<KiloLexicalComposerInput
							formatter={formatter}
							placeholder={placeholder}
							submitMode="enter"
							cancelOnEscape
							queueOnEnter={false}
							autoFocus
							label="Edit message"
							qaId="kilo-edit-message-input"
						/>
						<KiloSlashTrigger slash={slash} formatter={formatter} />
						<MentionTriggers sources={sources} context={mentionContext} formatter={formatter} />
						<div className="flex items-center gap-2">
							<p className="text-muted-foreground min-w-0 flex-1 text-xs">
								Saving reverts this and later messages, including file changes.
							</p>
							<ComposerPrimitive.Cancel
								render={<Button variant="ghost" size="sm" data-qa-id="kilo-edit-message-cancel" />}
							>
								Cancel
							</ComposerPrimitive.Cancel>
							<ComposerPrimitive.Send
								render={<Button size="sm" data-qa-id="kilo-edit-message-save" />}
							>
								Save
							</ComposerPrimitive.Send>
						</div>
					</ComposerPrimitive.Root>
				</ComposerPrimitive.Unstable_TriggerPopoverRoot>
			</MessagePrimitive.Root>
		</MentionIconsContext.Provider>
	);
};
