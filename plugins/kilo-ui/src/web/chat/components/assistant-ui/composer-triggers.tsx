"use client";

import type { ComponentType, FC } from "react";

import { useSdkContributions } from "@kilo-desktop/sdk-react";

import { useThreadWorkspace } from "../../use-workspace-directory.js";
import { ComposerTriggerPopover } from "./elements/composer-trigger-popover.aui.js";
import { KiloSlashTrigger } from "./kilo-slash-trigger.js";

export const CHAT_COMPOSER_TRIGGER_ZONE = "kilo-ui/chat-composer-trigger";

export interface ChatComposerTriggerContributionProps {
	readonly workspaceDirectory?: string;
	readonly workspaceFolders?: readonly {
		readonly path: string;
		readonly isPrimary: boolean;
	}[];
	readonly TriggerPopover: typeof ComposerTriggerPopover;
}

export const ComposerTriggers: FC = () => {
	const workspace = useThreadWorkspace();
	const workspaceDirectory =
		workspace?.folders.find((folder) => folder.isPrimary)?.path ?? workspace?.folders[0]?.path;
	const contributions = useSdkContributions(CHAT_COMPOSER_TRIGGER_ZONE);

	return (
		<>
			<KiloSlashTrigger />
			{contributions.map((contribution) => {
				if (typeof contribution.component !== "function") {
					console.warn(
						`[ComposerTriggers] Skipping contribution "${contribution.label}" from ` +
							`"${contribution.featureId}" in zone "${CHAT_COMPOSER_TRIGGER_ZONE}": component is not a React component.`,
					);
					return null;
				}
				const Component =
					contribution.component as ComponentType<ChatComposerTriggerContributionProps>;
				return (
					<Component
						key={`${contribution.featureId}:${contribution.id}`}
						TriggerPopover={ComposerTriggerPopover}
						{...(workspaceDirectory === undefined ? {} : { workspaceDirectory })}
						{...(workspace?.folders === undefined ? {} : { workspaceFolders: workspace.folders })}
					/>
				);
			})}
		</>
	);
};
