import { useEffect, useMemo, useState } from "react";

import { Button } from "@kilo-desktop/ui/components/button";
import { Checkbox } from "@kilo-desktop/ui/components/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@kilo-desktop/ui/components/dialog";
import { Input } from "@kilo-desktop/ui/components/input";

interface ChannelsDialogProps {
	open: boolean;
	availableChannels: string[];
	selectedChannels: string[];
	onCancel: () => void;
	onConfirm: (selected: string[]) => void;
}

/**
 * Channel selection dialog. Lets the user toggle which of the provider's
 * configured channels are used for the new environment. This is the simple
 * toggle view; full channel management (add / reorder / remove) is a
 * separate concern.
 */
export function ChannelsDialog({
	open,
	availableChannels,
	selectedChannels,
	onCancel,
	onConfirm,
}: ChannelsDialogProps) {
	const [working, setWorking] = useState<string[]>(selectedChannels);
	const [search, setSearch] = useState("");

	// Reset the working set to the caller's selection each time it opens.
	useEffect(() => {
		if (open) {
			setWorking(selectedChannels);
			setSearch("");
		}
	}, [open, selectedChannels]);

	const filtered = useMemo(() => {
		if (!search.trim()) return availableChannels;
		const lower = search.toLowerCase();
		return availableChannels.filter((c) => c.toLowerCase().includes(lower));
	}, [availableChannels, search]);

	const allSelected = availableChannels.length > 0 && working.length === availableChannels.length;

	function toggle(channel: string) {
		setWorking((prev) =>
			prev.includes(channel) ? prev.filter((c) => c !== channel) : [...prev, channel],
		);
	}

	return (
		<Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
			<DialogContent
				data-qa-id="environments-channels-dialog"
				className="flex max-h-[80vh] flex-col sm:max-w-[560px]"
			>
				<DialogHeader>
					<DialogTitle>Channels</DialogTitle>
					<DialogDescription>
						Choose which channels are used to resolve packages for this environment.
					</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-2">
					<Input
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						placeholder="Search channels…"
						data-qa-id="environments-channels-search"
					/>
					<div className="min-h-0 flex-1 overflow-y-auto rounded-lg border">
						<label className="hover:bg-accent flex items-center gap-2 border-b px-3 py-2 text-sm">
							<Checkbox
								checked={allSelected}
								onCheckedChange={() => setWorking(allSelected ? [] : [...availableChannels])}
								aria-label="All channels"
							/>
							<span className="font-medium">All channels</span>
						</label>
						{filtered.map((channel) => (
							<label
								key={channel}
								className="hover:bg-accent flex items-center gap-2 border-b px-3 py-2 text-sm last:border-b-0"
							>
								<Checkbox
									checked={working.includes(channel)}
									onCheckedChange={() => toggle(channel)}
									aria-label={channel}
								/>
								<span className="truncate">{channel}</span>
							</label>
						))}
						{filtered.length === 0 && (
							<p className="text-muted-foreground px-3 py-6 text-center text-sm">
								No channels match "{search}".
							</p>
						)}
					</div>
				</div>

				<DialogFooter className="border-t-0 bg-transparent">
					{working.length === 0 && (
						<p className="text-muted-foreground self-center text-xs">
							Select at least one channel.
						</p>
					)}
					<Button type="button" variant="outline" onClick={onCancel}>
						Cancel
					</Button>
					<Button
						type="button"
						disabled={working.length === 0}
						onClick={() => onConfirm(working)}
						data-qa-id="environments-channels-confirm"
					>
						Done
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
