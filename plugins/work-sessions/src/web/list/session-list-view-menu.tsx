import { Button } from "@kilo-desktop/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@kilo-desktop/ui/components/dropdown-menu";
import { ListFilterIcon } from "lucide-react";
import { type FC } from "react";

import {
	SESSION_LIST_GROUPINGS,
	SESSION_LIST_GROUPING_LABELS,
	SESSION_LIST_ORDERINGS,
	SESSION_LIST_ORDERING_LABELS,
	SESSION_LIST_PULL_REQUEST_FILTERS,
	SESSION_LIST_PULL_REQUEST_LABELS,
	SESSION_LIST_SHOW_FIELDS,
	SESSION_LIST_SHOW_LABELS,
	SESSION_LIST_STATUS_FILTERS,
	SESSION_LIST_STATUS_LABELS,
	isDefaultSessionListView,
	resolveSessionListGrouping,
	type SessionListGrouping,
	type SessionListOrdering,
	type SessionListPullRequestFilter,
	type SessionListShowField,
	type SessionListStatusFilter,
	type SessionListView,
} from "./session-list-view";

export const SessionListViewMenu: FC<{
	view: SessionListView;
	/** False when pull request status is unavailable (no git plugin). */
	pullRequestFilterAvailable: boolean;
	onViewChange: (patch: Partial<SessionListView>) => void;
	onReset: () => void;
	canCollapse: boolean;
	allCollapsed: boolean;
	onCollapseAll: () => void;
	onExpandAll: () => void;
}> = ({
	view,
	pullRequestFilterAvailable,
	onViewChange,
	onReset,
	canCollapse,
	allCollapsed,
	onCollapseAll,
	onExpandAll,
}) => {
	const customized = !isDefaultSessionListView(view);
	const grouping = resolveSessionListGrouping(view);
	const groupings = view.focus
		? SESSION_LIST_GROUPINGS.filter((entry) => entry !== "workspace")
		: SESSION_LIST_GROUPINGS;

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						aria-label="Session list options"
						data-qa-id="session-list-view-menu"
						data-active={customized || undefined}
						className="text-muted-foreground shrink-0 rounded-md"
					/>
				}
			>
				<ListFilterIcon />
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="start"
				side="right"
				sideOffset={6}
				collisionAvoidance={{ side: "none", align: "shift", fallbackAxisSide: "none" }}
				className="w-56"
			>
				<DropdownMenuGroup>
					<DropdownMenuSub>
						<SessionListSubTrigger
							label="Grouping"
							value={SESSION_LIST_GROUPING_LABELS[grouping]}
						/>
						<DropdownMenuSubContent>
							<DropdownMenuRadioGroup
								value={grouping}
								onValueChange={(value) => {
									if (value) onViewChange({ grouping: value as SessionListGrouping });
								}}
							>
								{groupings.map((entry) => (
									<DropdownMenuRadioItem key={entry} value={entry} closeOnClick={false}>
										{SESSION_LIST_GROUPING_LABELS[entry]}
									</DropdownMenuRadioItem>
								))}
							</DropdownMenuRadioGroup>
						</DropdownMenuSubContent>
					</DropdownMenuSub>
					<DropdownMenuSub>
						<SessionListSubTrigger
							label="Ordering"
							value={SESSION_LIST_ORDERING_LABELS[view.ordering]}
						/>
						<DropdownMenuSubContent>
							<DropdownMenuRadioGroup
								value={view.ordering}
								onValueChange={(value) => {
									if (value) onViewChange({ ordering: value as SessionListOrdering });
								}}
							>
								{SESSION_LIST_ORDERINGS.map((ordering) => (
									<DropdownMenuRadioItem key={ordering} value={ordering} closeOnClick={false}>
										{SESSION_LIST_ORDERING_LABELS[ordering]}
									</DropdownMenuRadioItem>
								))}
							</DropdownMenuRadioGroup>
						</DropdownMenuSubContent>
					</DropdownMenuSub>
					<DropdownMenuSub>
						<DropdownMenuSubTrigger className="w-full">Show</DropdownMenuSubTrigger>
						<DropdownMenuSubContent>
							<DropdownMenuGroup>
								{SESSION_LIST_SHOW_FIELDS.map((field) => (
									<DropdownMenuCheckboxItem
										key={field}
										checked={view.show.includes(field)}
										closeOnClick={false}
										onCheckedChange={(checked) => {
											onViewChange({
												show: toggleShow(view.show, field, checked === true),
											});
										}}
									>
										{SESSION_LIST_SHOW_LABELS[field]}
									</DropdownMenuCheckboxItem>
								))}
							</DropdownMenuGroup>
						</DropdownMenuSubContent>
					</DropdownMenuSub>
				</DropdownMenuGroup>
				<DropdownMenuSeparator />
				<DropdownMenuGroup>
					<DropdownMenuLabel>Filters</DropdownMenuLabel>
					<DropdownMenuSub>
						<SessionListSubTrigger label="Status" value={SESSION_LIST_STATUS_LABELS[view.status]} />
						<DropdownMenuSubContent>
							<DropdownMenuRadioGroup
								value={view.status}
								onValueChange={(value) => {
									if (value) onViewChange({ status: value as SessionListStatusFilter });
								}}
							>
								{SESSION_LIST_STATUS_FILTERS.map((status) => (
									<DropdownMenuRadioItem key={status} value={status} closeOnClick={false}>
										{SESSION_LIST_STATUS_LABELS[status]}
									</DropdownMenuRadioItem>
								))}
							</DropdownMenuRadioGroup>
						</DropdownMenuSubContent>
					</DropdownMenuSub>
					{pullRequestFilterAvailable ? (
						<DropdownMenuSub>
							<SessionListSubTrigger
								label="Pull request"
								value={SESSION_LIST_PULL_REQUEST_LABELS[view.pullRequest]}
							/>
							<DropdownMenuSubContent>
								<DropdownMenuRadioGroup
									value={view.pullRequest}
									onValueChange={(value) => {
										if (value) {
											onViewChange({ pullRequest: value as SessionListPullRequestFilter });
										}
									}}
								>
									{SESSION_LIST_PULL_REQUEST_FILTERS.map((filter) => (
										<DropdownMenuRadioItem key={filter} value={filter} closeOnClick={false}>
											{SESSION_LIST_PULL_REQUEST_LABELS[filter]}
										</DropdownMenuRadioItem>
									))}
								</DropdownMenuRadioGroup>
							</DropdownMenuSubContent>
						</DropdownMenuSub>
					) : null}
				</DropdownMenuGroup>
				<DropdownMenuSeparator />
				<DropdownMenuGroup>
					<DropdownMenuItem
						disabled={!canCollapse}
						onClick={allCollapsed ? onExpandAll : onCollapseAll}
					>
						{allCollapsed ? "Expand All" : "Collapse All"}
					</DropdownMenuItem>
					{customized ? <DropdownMenuItem onClick={onReset}>Reset view</DropdownMenuItem> : null}
				</DropdownMenuGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
};

function SessionListSubTrigger({ label, value }: { label: string; value: string }) {
	return (
		<DropdownMenuSubTrigger className="w-full">
			<span className="flex min-w-0 flex-1 items-center gap-1.5">
				<span>{label}</span>
				<span className="text-muted-foreground ml-auto">{value}</span>
			</span>
		</DropdownMenuSubTrigger>
	);
}

function toggleShow(
	show: readonly SessionListShowField[],
	field: SessionListShowField,
	checked: boolean,
): SessionListShowField[] {
	if (checked) {
		return SESSION_LIST_SHOW_FIELDS.filter((entry) => entry === field || show.includes(entry));
	}
	return show.filter((entry) => entry !== field);
}
