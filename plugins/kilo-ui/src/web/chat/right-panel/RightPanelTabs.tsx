import {
	type MouseEvent as ReactMouseEvent,
	type ReactNode,
	useEffect,
	useRef,
	type FC,
} from "react";
import { CircleHelpIcon, PlusIcon, XIcon } from "lucide-react";

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
import { type RightPanelTab, type RightPanelTabDefinition } from "./right-panel-tab-registry.js";

type RightPanelTabsProps = {
	maximized?: boolean;
	onToggleMaximized?: () => void;
	tabs: readonly RightPanelTab[];
	definitions: readonly RightPanelTabDefinition[];
	activeTabId: string | null;
	onActivate: (tab: RightPanelTab) => void;
	onCloseTab: (tab: RightPanelTab) => void;
	onAddTab: (definition: RightPanelTabDefinition) => void;
	children: ReactNode;
};

function definitionQaId(definition: RightPanelTabDefinition): string {
	return definition.id.replaceAll(/[^a-zA-Z0-9_-]/g, "-");
}

function RightPanelEmptyState({
	definitions,
	onAddTab,
}: {
	definitions: readonly RightPanelTabDefinition[];
	onAddTab: (definition: RightPanelTabDefinition) => void;
}) {
	return (
		<div
			className="flex min-h-0 flex-1 items-center justify-center p-4"
			data-qa-id="chat-right-panel-empty"
		>
			<div className="flex w-full max-w-xl flex-col gap-2">
				{definitions.map((definition) => {
					const { Icon } = definition;
					return (
						<button
							key={definition.id}
							type="button"
							onClick={() => onAddTab(definition)}
							data-qa-id={`chat-right-panel-open-${definitionQaId(definition)}`}
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
	definitions,
	activeTabId,
	onActivate,
	onCloseTab,
	onAddTab,
	children,
}) => {
	const tabListRef = useRef<HTMLDivElement>(null);
	const addableDefinitions = definitions.filter(({ addable }) => addable);

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
						const active = tab.instanceId === activeTabId;
						const definition = definitions.find(({ id }) => id === tab.definitionId);
						const Icon = definition?.Icon ?? CircleHelpIcon;
						const title = tab.title;
						const dirtyDescriptionId = `right-panel-tab-dirty-${tab.instanceId}`;
						return (
							<div
								key={tab.instanceId}
								data-active-tab={active}
								data-dirty={tab.dirty ? "true" : "false"}
								data-qa-id={`chat-right-panel-tab-${tab.instanceId}`}
								onMouseDown={handleTabMouseDown}
								onAuxClick={(event) => handleTabAuxClick(event, tab)}
								className={cn(
									"flex h-7 max-w-36 shrink-0 items-stretch rounded-[min(var(--radius-md),12px)] text-xs",
									active
										? "bg-foreground/5 text-foreground"
										: "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
								)}
							>
								<TooltipProvider>
									<Tooltip>
										<TooltipTrigger
											render={
												<button
													type="button"
													className="flex min-w-0 flex-1 items-center gap-1 rounded-l-[min(var(--radius-md),12px)] pl-1.5 text-left"
													aria-describedby={tab.dirty ? dirtyDescriptionId : undefined}
													onClick={() => onActivate(tab)}
												/>
											}
										>
											<span className="flex size-3 shrink-0 items-center justify-center">
												<Icon
													className="size-3"
													{...(tab.iconKey ? { iconKey: tab.iconKey } : {})}
												/>
											</span>
											<span className="truncate">{title}</span>
											{tab.dirty ? (
												<>
													<span
														className="bg-foreground ml-1 size-1.5 shrink-0 rounded-full"
														aria-hidden="true"
														data-qa-id={`chat-right-panel-dirty-${tab.instanceId}`}
													/>
													<span id={dirtyDescriptionId} className="sr-only">
														Unsaved changes
													</span>
												</>
											) : null}
										</TooltipTrigger>
										<TooltipContent side="bottom">{title}</TooltipContent>
									</Tooltip>
								</TooltipProvider>
								<button
									type="button"
									className="group/close-tab text-muted-foreground flex h-full w-5 shrink-0 items-center justify-center rounded-l-sm rounded-r-[min(var(--radius-md),12px)]"
									aria-label={`Close ${title}`}
									data-qa-id={`chat-right-panel-close-tab-${tab.instanceId}`}
									onClick={() => onCloseTab(tab)}
								>
									<span
										className="group-hover/close-tab:bg-muted group-hover/close-tab:text-foreground group-focus-visible/close-tab:bg-muted group-focus-visible/close-tab:text-foreground flex size-4 items-center justify-center rounded-sm transition-colors"
										data-qa-id={`chat-right-panel-close-hover-${tab.instanceId}`}
									>
										<XIcon className="size-3" />
									</span>
								</button>
							</div>
						);
					})}
					{tabs.length > 0 && addableDefinitions.length > 0 ? (
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
									{addableDefinitions.map((definition) => {
										const { Icon } = definition;
										return (
											<DropdownMenuItem
												key={definition.id}
												onClick={() => onAddTab(definition)}
												data-qa-id={`chat-right-panel-add-${definitionQaId(definition)}`}
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
				{activeTabId === null ? (
					<RightPanelEmptyState definitions={addableDefinitions} onAddTab={onAddTab} />
				) : (
					children
				)}
			</div>
		</div>
	);
};
