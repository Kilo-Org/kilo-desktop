"use client";

import type { ComponentType, FC, ReactNode } from "react";
import { ArrowDownToLineIcon, ArrowUpIcon, FolderIcon } from "lucide-react";

import { useSdkContributions } from "@anaconda-agentic-desktop/sdk-react";

import { workspaceGlyphColor } from "../../../workspaces/workspace-glyph-style.js";
import { useThreadWorkspace, useThreadWorkspaceDirectory } from "../../use-workspace-directory.js";
import { useComposerUsageView } from "../../usage/use-session-model-usage.js";
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
const railLabel = "text-foreground/70 flex h-7 min-w-0 items-center gap-1.5 text-xs";

const ComposerWorkspaceLabel: FC = () => {
	const workspace = useThreadWorkspace();
	if (!workspace) return null;
	const glyph = workspaceGlyphColor(workspace.color);

	return (
		<span
			data-qa-id="kilo-composer-workspace"
			aria-label={`Workspace ${workspace.name}`}
			title={workspace.name}
			className={`${railLabel} @max-[22rem]:hidden`}
		>
			<FolderIcon
				className="text-foreground/40 size-3 shrink-0"
				aria-hidden
				{...(glyph ? { color: glyph } : {})}
			/>
			<span className="truncate">{workspace.name}</span>
		</span>
	);
};

/** Active-thread strip under the composer: workspace, contributed chrome, and usage. */
export const ComposerFooter: FC = () => {
	const view = useComposerUsageView();
	const workspaceDirectory = useThreadWorkspaceDirectory();
	const contributions = useSdkContributions(CHAT_COMPOSER_FOOTER_ZONE);
	if (!view) return null;

	return (
		<div
			data-qa-id="kilo-composer-footer"
			className="@container relative z-10 flex w-full min-w-0 items-center justify-between gap-2 overflow-visible bg-[var(--pane-surface,var(--color-background))]"
		>
			<div
				aria-hidden
				className="pointer-events-none absolute -inset-x-4 -top-1.5 -bottom-1.5 bg-[var(--pane-surface,var(--color-background))]"
			/>
			<div className="relative flex min-w-0 flex-1 items-center gap-2 overflow-hidden pl-2.5 @min-[32rem]:gap-4">
				<ComposerWorkspaceLabel />
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
							<Component {...(workspaceDirectory === undefined ? {} : { workspaceDirectory })} />
						</span>
					);
				})}
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
