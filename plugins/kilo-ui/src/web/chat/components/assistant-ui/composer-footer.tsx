"use client";

import type { ComponentType, FC, ReactNode } from "react";
import { ArrowDownToLineIcon, ArrowUpIcon, FolderIcon, GitForkIcon } from "lucide-react";

import { useSdkContributions } from "@kilo-desktop/sdk-react";

import {
	useThreadWorkingDirectory,
	useThreadWorkspaceDirectory,
	useThreadWorkspaceId,
} from "../../../session/workspace/use-workspace-directory.js";
import { directoryBasename } from "../../../session/activity/session-activity-logic.js";
import { useComposerUsageView } from "../../usage/use-session-model-usage.js";
import { useIsThreadAwaitingWorktree } from "../../worktree-setup/WorktreeSetupContext.js";
import { WorkspaceUnavailableFoldersIndicator } from "../../../workspaces/WorkspaceUnavailableFoldersIndicator.js";
import { ComposerContext } from "./elements/composer-context.js";
import { CostMeter } from "./elements/cost-meter.js";

/**
 * Qualified id of the active-thread composer footer zone, owned by kilo-ui.
 * Other plugins contribute left-side chrome through `contributes.zones`.
 */
export const CHAT_COMPOSER_FOOTER_ZONE = "kilo-ui/chat-composer-footer";

/** Context kilo-ui supplies when it renders an active-footer contribution. */
export interface ChatComposerFooterContributionProps {
	/** Primary folder path of the thread workspace; absent when unscoped. */
	readonly workspaceDirectory?: string;
	/**
	 * The session's effective working directory — the worktree when
	 * worktree-backed, otherwise the same as `workspaceDirectory`; absent
	 * when unscoped or while the session's worktree is still being set up.
	 */
	readonly workingDirectory?: string;
}

const Metric: FC<{ icon?: ReactNode; value: string; qa: string }> = ({ icon, value, qa }) => {
	return (
		<span data-qa-id={qa} className="flex items-center gap-0.5">
			{icon}
			<span className="text-foreground/70 text-xs tracking-tight tabular-nums">{value}</span>
		</span>
	);
};

const metricIcon = "size-3 text-foreground/40";

export const ComposerSessionMode: FC<{ isWorktree: boolean; name?: string | undefined }> = ({
	isWorktree,
	name,
}) => {
	const label = isWorktree ? (name ?? "Worktree") : "Local";
	const Icon = isWorktree ? GitForkIcon : FolderIcon;
	return (
		<span
			data-qa-id="kilo-composer-session-mode"
			aria-label={`Session mode ${label}`}
			className="text-foreground/70 flex h-7 min-w-0 items-center gap-1.5 text-xs"
		>
			<Icon className="text-foreground/40 size-3 shrink-0" aria-hidden />
			<span>{label}</span>
		</span>
	);
};

/** Active-thread strip under the composer: contributed session chrome and usage. */
export const ComposerFooter: FC = () => {
	const view = useComposerUsageView();
	const workspaceId = useThreadWorkspaceId();
	const workspaceDirectory = useThreadWorkspaceDirectory();
	const resolvedWorkingDirectory = useThreadWorkingDirectory();
	const isAwaitingWorktree = useIsThreadAwaitingWorktree();
	// Until the worktree session exists its directory is unknown; the
	// resolved fallback would be the workspace checkout and its branch.
	const workingDirectory = isAwaitingWorktree ? undefined : resolvedWorkingDirectory;
	const contributions = useSdkContributions(CHAT_COMPOSER_FOOTER_ZONE);
	if (!view) return null;

	return (
		<div
			data-qa-id="kilo-composer-footer"
			className="bg-pane @container relative z-10 flex w-full min-w-0 items-center justify-between gap-2 overflow-visible"
		>
			<div
				aria-hidden
				className="bg-pane pointer-events-none absolute -inset-x-4 -top-1.5 -bottom-1.5"
			/>
			<div className="relative flex min-w-0 flex-1 items-center gap-1 overflow-hidden pl-2.5">
				<div className="flex shrink-0 items-center gap-1.5">
					<ComposerSessionMode
						isWorktree={
							isAwaitingWorktree ||
							(workspaceDirectory !== undefined &&
								workingDirectory !== undefined &&
								workingDirectory !== workspaceDirectory)
						}
						name={
							workspaceDirectory !== undefined &&
							workingDirectory !== undefined &&
							workingDirectory !== workspaceDirectory
								? directoryBasename(workingDirectory)
								: undefined
						}
					/>
					<WorkspaceUnavailableFoldersIndicator workspaceId={workspaceId} compact />
				</div>
				<div className="flex items-center gap-1.5">
					{contributions.map((contribution) => {
						if (typeof contribution.component !== "function") {
							console.warn(
								`[ComposerFooter] Skipping contribution "${contribution.label}" from ` +
									`"${contribution.featureId}" in zone "${CHAT_COMPOSER_FOOTER_ZONE}": component is not a React component.`,
							);
							return null;
						}
						const Component =
							contribution.component as ComponentType<ChatComposerFooterContributionProps>;
						return (
							<span key={`${contribution.featureId}:${contribution.id}`} className="flex min-w-0">
								<Component
									{...(workspaceDirectory === undefined ? {} : { workspaceDirectory })}
									{...(workingDirectory === undefined ? {} : { workingDirectory })}
								/>
							</span>
						);
					})}
				</div>
			</div>
			<ComposerContext
				className="relative shrink-0"
				usage={view.context}
				tokens={view.tokenUsage}
				rail={
					<span className="flex items-center gap-2.5">
						<span className="flex items-center gap-2.5 @max-[32rem]:hidden">
							<Metric
								icon={<ArrowUpIcon className={metricIcon} aria-hidden />}
								value={view.tokensInLabel}
								qa="kilo-composer-footer-tokens-in"
							/>
							<Metric
								icon={<ArrowDownToLineIcon className={metricIcon} aria-hidden />}
								value={view.tokensOutLabel}
								qa="kilo-composer-footer-tokens-out"
							/>
						</span>
						<Metric value={view.costLabel} qa="kilo-composer-footer-cost" />
					</span>
				}
			>
				<CostMeter
					runCost={view.runCost}
					sessionCost={view.sessionCost}
					lines={view.lines}
					className="max-w-none border-0 bg-transparent p-0 shadow-none"
				/>
			</ComposerContext>
		</div>
	);
};
