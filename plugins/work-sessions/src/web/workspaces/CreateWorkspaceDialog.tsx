import { ArrowRightIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@kilo-desktop/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@kilo-desktop/ui/components/dialog";
import { Item, ItemActions, ItemGroup } from "@kilo-desktop/ui/components/item";
import { Spinner } from "@kilo-desktop/ui/components/spinner";
import { SummaryCard } from "@kilo-desktop/ui/components/summary-card";
import { cn } from "@kilo-desktop/ui/lib/utils";

import {
	ScreensViewport,
	SourceIcon,
	SourceScreens,
	useActivateCreated,
	useFolderLocationServices,
	useScreenState,
	useWorkspaceSources,
	type SourceContribution,
} from "./workspace-source-host";

/**
 * The New workspace dialog: first how to start (the `workspace-source`
 * contributions, highest priority first), then that source's screens in the
 * dialog's header, body and footer. A created workspace becomes active and
 * the dialog closes. It can't be dismissed while the action runs.
 */
export function CreateWorkspaceDialog({ onClose }: { onClose(): void }) {
	const sources = useWorkspaceSources();
	const [chosenKey, setChosenKey] = useState<string | null>(null);
	const chosen = sources.find((source) => source.key === chosenKey) ?? null;
	const locations = useFolderLocationServices();
	const onCreated = useActivateCreated(onClose);
	const { screen, primary, report, reset } = useScreenState();
	const changeSource = () => {
		reset();
		setChosenKey(null);
	};
	// While a source's action runs (a clone), the dialog can't be dismissed: the
	// action would still create and activate the workspace after it closed.
	const busy = chosen !== null && screen?.busy === true;

	return (
		<Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
			<DialogContent
				showCloseButton={!busy}
				data-qa-id="workspace-create-dialog"
				className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
			>
				{chosen ? (
					<>
						<DialogHeader>
							<DialogTitle>New workspace</DialogTitle>
							{screen?.description ? (
								<DialogDescription>{screen.description}</DialogDescription>
							) : null}
						</DialogHeader>
						<ScreensViewport>
							<SourceScreens
								source={chosen}
								services={{ ...locations, onCreated, appearance: "outlined", origin: "dialog" }}
								report={report}
								onChangeSource={changeSource}
							/>
						</ScreensViewport>
						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								className="sm:mr-auto"
								disabled={busy}
								onClick={onClose}
							>
								Cancel
							</Button>
							{primary ? (
								<Button type="button" disabled={busy || primary.disabled} onClick={primary.onClick}>
									{busy ? <Spinner data-icon="inline-start" aria-hidden="true" /> : null}
									{primary.label}
								</Button>
							) : null}
						</DialogFooter>
					</>
				) : (
					<SourceStep sources={sources} onSelect={setChosenKey} onCancel={onClose} />
				)}
			</DialogContent>
		</Dialog>
	);
}

function SourceStep({
	sources,
	onSelect,
	onCancel,
}: {
	sources: readonly SourceContribution[];
	onSelect(key: string): void;
	onCancel(): void;
}) {
	// Two to a row; an odd last one spans the row.
	const spansRow = (index: number) => sources.length % 2 === 1 && index === sources.length - 1;
	return (
		<>
			<DialogHeader>
				<DialogTitle>New workspace</DialogTitle>
				<DialogDescription>Choose how to start your workspace.</DialogDescription>
			</DialogHeader>
			<ItemGroup className="grid gap-2 sm:grid-cols-2">
				{sources.map((source, index) => (
					<Item
						key={source.key}
						variant="outline"
						size="sm"
						render={
							<button
								type="button"
								data-qa-id={`workspace-source-${source.key}`}
								onClick={() => onSelect(source.key)}
							/>
						}
						className={cn(
							"bg-card hover:bg-muted min-w-0 flex-nowrap text-left",
							spansRow(index) && "sm:col-span-2",
						)}
					>
						<SummaryCard.Icon>
							<SourceIcon source={source} className="size-4" />
						</SummaryCard.Icon>
						<SummaryCard.Content>
							<SummaryCard.Title>{source.metadata.title}</SummaryCard.Title>
							<SummaryCard.Description>{source.metadata.description}</SummaryCard.Description>
						</SummaryCard.Content>
						<ItemActions>
							<ArrowRightIcon className="text-muted-foreground size-4" aria-hidden="true" />
						</ItemActions>
					</Item>
				))}
			</ItemGroup>
			<DialogFooter>
				<Button type="button" variant="outline" onClick={onCancel}>
					Cancel
				</Button>
			</DialogFooter>
		</>
	);
}
