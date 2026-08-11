import {
	type MouseEvent as ReactMouseEvent,
	type ReactNode,
	useEffect,
	useRef,
	type FC,
} from "react";
import { PlusIcon, XIcon } from "lucide-react";

import { Button } from "@anaconda-agentic-desktop/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@anaconda-agentic-desktop/ui/components/dropdown-menu";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@anaconda-agentic-desktop/ui/components/tooltip";
import { cn } from "@anaconda-agentic-desktop/ui/lib/utils";

import { RightPanelMaximizeControl } from "./RightPanelControls.js";
import {
	ADDABLE_RIGHT_PANEL_TABS,
	getRightPanelTabDefinition,
	type RightPanelTab,
	type RightPanelTabKind,
} from "./right-panel-tab-registry.js";

type RightPanelTabsProps = {
	maximized?: boolean;
	onToggleMaximized?: () => void;
	tabs: readonly RightPanelTab[];
	activeTabId: string | null;
	onActivate: (tab: RightPanelTab) => void;
	onCloseTab: (tab: RightPanelTab) => void;
	onAddTab: (kind: RightPanelTabKind) => void;
	children: ReactNode;
};

function RightPanelEmptyState({ onAddTab }: { onAddTab: (kind: RightPanelTabKind) => void }) {
	return (
		<div
			className="flex min-h-0 flex-1 items-center justify-center p-4"
			data-qa-id="chat-right-panel-empty"
		>
			<div className="flex w-full max-w-xl flex-col gap-2">
				{ADDABLE_RIGHT_PANEL_TABS.map((definition) => {
					const { Icon } = definition;
					return (
						<button
							key={definition.kind}
							type="button"
							onClick={() => onAddTab(definition.kind)}
							data-qa-id={`chat-right-panel-open-${definition.kind}`}
							className="bg-card hover:bg-accent/60 border-border/80 hover:border-border flex w-full items-start gap-3 rounded-lg border p-3 text-left transition"
						>
							<Icon className="mt-0.5 size-5 shrink-0" />
							<span className="flex min-w-0 flex-col gap-0.5">
								<span className="text-sm font-medium">{definition.title}</span>
								<span className="text-muted-foreground text-xs leading-relaxed">
									{definition.description}
								</span>
							</span>
						</button>
					);
				})}
			</div>
		</div>
	);
}

export const RightPanelTabs: FC<RightPanelTabsProps> = ({
	maximized = false,
	onToggleMaximized,
	tabs,
	activeTabId,
	onActivate,
	onCloseTab,
	onAddTab,
	children,
}) => {
	const tabListRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const activeTab = tabListRef.current?.querySelector<HTMLElement>("[data-active-tab='true']");
		activeTab?.scrollIntoView({ block: "nearest", inline: "nearest" });
	}, [activeTabId]);

	const handleTabMouseDown = (event: ReactMouseEvent) => {
		if (event.button !== 1) return;
		event.preventDefault();
	};

	const handleTabAuxClick = (event: ReactMouseEvent, tab: RightPanelTab) => {
		if (event.button !== 1) return;
		event.preventDefault();
		event.stopPropagation();
		onCloseTab(tab);
	};

	return (
		<div
			className={cn(
				"bg-muted border-border relative flex h-full min-h-0 min-w-0 flex-col self-stretch overflow-hidden rounded-md border",
				maximized ? "flex-1" : "shrink-0",
			)}
			data-qa-id="chat-right-panel"
			data-right-panel-maximized={maximized ? "true" : "false"}
		>
			<div
				className="border-border flex h-11 shrink-0 items-center gap-1 border-b pr-2 pl-2"
				data-qa-id="chat-right-panel-tabbar"
			>
				<div
					ref={tabListRef}
					className="flex min-w-0 flex-1 scrollbar-none items-center gap-1 overflow-x-auto"
					data-qa-id="chat-right-panel-tab-list"
				>
					{tabs.map((tab) => {
						const active = tab.id === activeTabId;
						const definition = getRightPanelTabDefinition(tab.kind);
						const { Icon } = definition;
						const title = definition.title;
						return (
							<div
								key={tab.id}
								data-active-tab={active}
								data-qa-id={`chat-right-panel-tab-${tab.id}`}
								onMouseDown={handleTabMouseDown}
								onAuxClick={(event) => handleTabAuxClick(event, tab)}
								className={cn(
									"flex h-7 max-w-36 shrink-0 items-center gap-0.5 rounded-[min(var(--radius-md),12px)] pr-1 pl-1.5 text-xs",
									active
										? "bg-foreground/5 text-foreground"
										: "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
								)}
							>
								<span className="flex size-3 shrink-0 items-center justify-center">
									<Icon className="size-3" />
								</span>
								<TooltipProvider>
									<Tooltip>
										<TooltipTrigger
											render={
												<button
													type="button"
													className="flex min-w-0 flex-1 items-center"
													onClick={() => onActivate(tab)}
												/>
											}
										>
											<span className="truncate">{title}</span>
										</TooltipTrigger>
										<TooltipContent side="bottom">{title}</TooltipContent>
									</Tooltip>
								</TooltipProvider>
								<button
									type="button"
									className="text-muted-foreground hover:bg-muted hover:text-foreground ml-1 flex size-4 shrink-0 items-center justify-center rounded-sm"
									aria-label={`Close ${title}`}
									data-qa-id={`chat-right-panel-close-tab-${tab.id}`}
									onClick={() => onCloseTab(tab)}
								>
									<XIcon className="size-3" />
								</button>
							</div>
						);
					})}
					{tabs.length > 0 && ADDABLE_RIGHT_PANEL_TABS.length > 0 ? (
						<DropdownMenu>
							<DropdownMenuTrigger
								render={
									<Button
										type="button"
										variant="ghost"
										size="icon-sm"
										aria-label="Add panel tab"
										data-qa-id="chat-right-panel-add-tab"
										className="text-muted-foreground"
									/>
								}
							>
								<PlusIcon />
							</DropdownMenuTrigger>
							<DropdownMenuContent align="start" side="bottom" sideOffset={6} className="min-w-44">
								<DropdownMenuGroup>
									{ADDABLE_RIGHT_PANEL_TABS.map((definition) => {
										const { Icon } = definition;
										return (
											<DropdownMenuItem
												key={definition.kind}
												onClick={() => onAddTab(definition.kind)}
												data-qa-id={`chat-right-panel-add-${definition.kind}`}
											>
												<Icon data-icon="inline-start" />
												{definition.title}
											</DropdownMenuItem>
										);
									})}
								</DropdownMenuGroup>
							</DropdownMenuContent>
						</DropdownMenu>
					) : null}
				</div>
				{onToggleMaximized ? (
					<RightPanelMaximizeControl maximized={maximized} onToggle={onToggleMaximized} />
				) : null}
			</div>
			<div className="flex min-h-0 flex-1 flex-col" data-qa-id="chat-right-panel-content">
				{activeTabId === null ? <RightPanelEmptyState onAddTab={onAddTab} /> : children}
			</div>
		</div>
	);
};
