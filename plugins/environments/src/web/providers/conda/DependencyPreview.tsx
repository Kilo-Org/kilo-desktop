import { useState } from "react";

import {
	AlertTriangleIcon,
	ArrowRightIcon,
	ChevronDownIcon,
	ChevronRightIcon,
	ClipboardCopyIcon,
	MaximizeIcon,
	MinimizeIcon,
	MinusIcon,
	PlusIcon,
	RepeatIcon,
} from "lucide-react";

import { Badge } from "@anaconda-agentic-desktop/ui/components/badge";
import { toast } from "@anaconda-agentic-desktop/ui/components/sonner";
import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";

import type { CondaPackageChange } from "../../../contracts/providers/conda.js";

export type ChangeFilter = "all" | "upgraded" | "downgraded" | "added" | "removed" | "rebuilt";

export interface ChangeSection {
	key: string;
	title: string;
	icon: React.ReactNode;
	variant: "upgrade" | "downgrade" | "add" | "remove";
	changes: CondaPackageChange[];
	totalCount: number;
}

/** Default category icons keyed by change kind. */
export const CHANGE_ICONS: Record<string, React.ReactNode> = {
	upgraded: <ArrowUpIcon className="size-3.5 text-green-600" />,
	downgraded: <ArrowDownIcon className="size-3.5 text-amber-600" />,
	added: <PlusIcon className="size-3.5 text-blue-600" />,
	removed: <MinusIcon className="size-3.5 text-red-600" />,
	rebuilt: <RepeatIcon className="size-3.5 text-gray-600" />,
};

export const CHANGE_VARIANT: Record<string, ChangeSection["variant"]> = {
	upgraded: "upgrade",
	downgraded: "downgrade",
	added: "add",
	removed: "remove",
	rebuilt: "upgrade",
};

export function PreviewContent({
	sections,
	collapsed,
	onToggleCollapse,
}: {
	sections: ChangeSection[];
	collapsed: Record<string, boolean>;
	onToggleCollapse: (key: string) => void;
}) {
	if (sections.length === 0) {
		return <p className="text-muted-foreground py-4 text-center text-xs">No matching changes.</p>;
	}
	return (
		<div className="space-y-2">
			{sections.map((section) => (
				<CollapsibleChangeSection
					key={section.key}
					sectionKey={section.key}
					title={section.title}
					icon={section.icon}
					variant={section.variant}
					changes={section.changes}
					totalCount={section.totalCount}
					isCollapsed={collapsed[section.key] ?? false}
					onToggle={onToggleCollapse}
				/>
			))}
		</div>
	);
}

function CollapsibleChangeSection({
	sectionKey,
	title,
	icon,
	variant,
	changes,
	totalCount,
	isCollapsed,
	onToggle,
}: {
	sectionKey: string;
	title: string;
	icon: React.ReactNode;
	variant: "upgrade" | "downgrade" | "add" | "remove";
	changes: CondaPackageChange[];
	totalCount: number;
	isCollapsed: boolean;
	onToggle: (key: string) => void;
}) {
	return (
		<div>
			<button
				type="button"
				className="hover:bg-muted/50 flex w-full items-center gap-1.5 rounded px-1 py-1 text-xs font-semibold"
				onClick={() => onToggle(sectionKey)}
			>
				{isCollapsed ? (
					<ChevronRightIcon className="text-muted-foreground size-3.5" />
				) : (
					<ChevronDownIcon className="text-muted-foreground size-3.5" />
				)}
				{icon}
				{title}
				<Badge variant="secondary" className="ml-1 text-[10px]">
					{changes.length !== totalCount ? `${changes.length}/${totalCount}` : totalCount}
				</Badge>
			</button>
			{!isCollapsed && (
				<div className="mt-1 rounded-md border text-xs">
					{changes.length === 0 ? (
						<p className="text-muted-foreground px-2.5 py-1.5">No matches in this category.</p>
					) : (
						changes.map((change) => (
							<div
								key={change.name}
								className="flex items-center gap-2 border-b px-2.5 py-1.5 last:border-b-0"
							>
								<span className="min-w-0 flex-1 truncate font-medium">{change.name}</span>
								{variant === "add" && (
									<span className="text-muted-foreground shrink-0">{change.toVersion}</span>
								)}
								{variant === "remove" && (
									<span className="text-muted-foreground shrink-0 line-through">
										{change.fromVersion}
									</span>
								)}
								{variant === "upgrade" && (
									<span className="text-muted-foreground flex shrink-0 items-center gap-1">
										{change.fromVersion}
										<ArrowRightIcon className="size-3" />
										<span className="font-medium text-green-700 dark:text-green-400">
											{change.toVersion}
										</span>
									</span>
								)}
								{variant === "downgrade" && (
									<span className="text-muted-foreground flex shrink-0 items-center gap-1">
										{change.fromVersion}
										<ArrowRightIcon className="size-3" />
										<span className="font-medium text-red-600 dark:text-red-400">
											{change.toVersion}
										</span>
									</span>
								)}
							</div>
						))
					)}
				</div>
			)}
		</div>
	);
}

export function SolverErrorCard({
	message,
	detail,
	qaId,
}: {
	message: string;
	detail?: string;
	qaId?: string;
}) {
	const [expanded, setExpanded] = useState(false);
	const [copied, setCopied] = useState(false);

	function handleCopy() {
		const text = detail ? `${message}\n\n${detail}` : message;
		navigator.clipboard.writeText(text).then(
			() => {
				setCopied(true);
				setTimeout(() => setCopied(false), 2000);
			},
			() => {
				toast.error("Could not copy to clipboard");
			},
		);
	}

	return (
		<div
			className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center overflow-hidden"
			data-qa-id={qaId}
		>
			<div
				className={`flex min-w-0 flex-col rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/30 ${
					expanded ? "h-full w-full" : "mx-auto max-w-sm"
				}`}
			>
				<div className="flex items-start gap-3 px-5 pt-4 pb-3">
					<AlertTriangleIcon className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" />
					<div className="min-w-0 flex-1 space-y-1">
						<p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
							Resolve conflict
						</p>
						<p className="text-xs text-amber-800 dark:text-amber-300">{message}</p>
					</div>
					<div className="flex shrink-0 items-center gap-1">
						<button
							type="button"
							onClick={handleCopy}
							className="rounded p-1 text-amber-600 hover:bg-amber-200/60 dark:text-amber-400 dark:hover:bg-amber-900/40"
							aria-label="Copy to clipboard"
						>
							{copied ? (
								<span className="text-[10px] font-medium">Copied</span>
							) : (
								<ClipboardCopyIcon className="size-3.5" />
							)}
						</button>
						{detail && (
							<button
								type="button"
								onClick={() => setExpanded((e) => !e)}
								className="rounded p-1 text-amber-600 hover:bg-amber-200/60 dark:text-amber-400 dark:hover:bg-amber-900/40"
								aria-label={expanded ? "Collapse details" : "Expand details"}
							>
								{expanded ? (
									<MinimizeIcon className="size-3.5" />
								) : (
									<MaximizeIcon className="size-3.5" />
								)}
							</button>
						)}
					</div>
				</div>
				{detail && (
					<div className={`min-h-0 min-w-0 overflow-auto px-5 pb-4 ${expanded ? "flex-1" : ""}`}>
						<pre
							className={`rounded bg-amber-100/60 px-2.5 py-2 font-mono text-[10px] leading-relaxed break-all whitespace-pre-wrap text-amber-900 dark:bg-amber-950/50 dark:text-amber-200 ${
								expanded ? "" : "max-h-32"
							} overflow-auto`}
						>
							{detail}
						</pre>
					</div>
				)}
			</div>
		</div>
	);
}
