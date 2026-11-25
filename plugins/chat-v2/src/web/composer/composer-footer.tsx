import type { FC, ReactNode } from "react";
import { ArrowDownToLineIcon, ArrowUpIcon, FolderIcon, GitForkIcon } from "lucide-react";

import type { ComposerUsageView } from "../usage/session-model-usage";
import { useComposerUsageView } from "../usage/use-session-model-usage";
import { ComposerContext as ComposerUsage } from "../usage/composer-context";
import { CostMeter } from "../usage/cost-meter";
import { ComposerActionSlotView, useComposerContext } from "./composer-actions";

const basename = (path: string) =>
	path
		.replace(/[\\/]+$/u, "")
		.split(/[\\/]/u)
		.at(-1) ?? path;

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

/**
 * The strip under a chat's composer: where the chat works (its folder or
 * worktree), `footer` composer actions (git's branch) and the chat's usage.
 * A new chat in a session already knows where it works, so it shows the
 * strip before its first message, with no usage yet.
 */
export const ComposerFooter: FC = () => {
	const view = useComposerUsageView();
	const { directory, workspaceFolders } = useComposerContext();
	const workspaceDirectory =
		workspaceFolders.find((folder) => folder.isPrimary)?.path ?? workspaceFolders[0]?.path;
	const isWorktree =
		workspaceDirectory !== undefined && directory !== null && directory !== workspaceDirectory;

	return (
		<div
			data-qa-id="kilo-composer-footer"
			className="bg-pane @container relative z-10 flex w-full min-w-0 items-center justify-between gap-2 overflow-visible"
		>
			<div
				aria-hidden
				className="bg-pane pointer-events-none absolute -inset-x-4 -top-1.5 -bottom-1.5"
			/>
			<div className="relative flex min-w-0 flex-1 items-center gap-2 overflow-hidden pl-2.5 @min-[32rem]:gap-4">
				<ComposerSessionMode
					isWorktree={isWorktree}
					name={isWorktree ? basename(directory) : undefined}
				/>
				<ComposerActionSlotView slot="footer" />
			</div>
			{view ? <FooterUsage view={view} /> : null}
		</div>
	);
};

/** The chat's context and cost, once it has run. */
const FooterUsage: FC<{ view: ComposerUsageView }> = ({ view }) => (
	<ComposerUsage
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
			className="max-w-none border-0 bg-transparent p-0 shadow-none"
		/>
	</ComposerUsage>
);
