import { useState } from "react";

import { Button } from "@anaconda-agentic-desktop/ui/components/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@anaconda-agentic-desktop/ui/components/command";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@anaconda-agentic-desktop/ui/components/popover";
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";

/** Sentinel for the "Latest" choice (caller omits an explicit python spec). */
export const PYTHON_LATEST = "__latest__";

interface PythonVersionPickerProps {
	/** Current value: `PYTHON_LATEST` or a concrete version string. */
	value: string;
	/** Available versions, newest first (patch-level, e.g. `3.12.4`). */
	versions: string[];
	onChange: (value: string) => void;
}

/**
 * Searchable Python-version combobox. With a full repodata version list
 * (dozens of entries) a plain dropdown is unwieldy, so this pairs a trigger
 * with a `Command` search box: type to filter, pick a version or "Latest".
 */
export function PythonVersionPicker({ value, versions, onChange }: PythonVersionPickerProps) {
	const [open, setOpen] = useState(false);
	const label = value === PYTHON_LATEST ? "Latest" : value;

	function select(next: string) {
		onChange(next);
		setOpen(false);
	}

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger
				render={
					<Button
						type="button"
						variant="outline"
						role="combobox"
						aria-expanded={open}
						aria-label="Python version"
						className="w-full justify-between font-normal"
						data-qa-id="environments-create-python"
					/>
				}
			>
				{label}
				<ChevronsUpDownIcon className="text-muted-foreground" />
			</PopoverTrigger>
			<PopoverContent align="start" sideOffset={6} className="w-(--anchor-width) gap-0 p-0">
				<Command>
					<CommandInput
						placeholder="Search versions…"
						data-qa-id="environments-create-python-search"
					/>
					<CommandList>
						<CommandEmpty>No matching versions.</CommandEmpty>
						<CommandGroup>
							<CommandItem value="latest" onSelect={() => select(PYTHON_LATEST)}>
								Latest
								{value === PYTHON_LATEST && <CheckIcon className="ml-auto" />}
							</CommandItem>
							{versions.map((v) => (
								<CommandItem key={v} value={v} onSelect={() => select(v)}>
									{v}
									{value === v && <CheckIcon className="ml-auto" />}
								</CommandItem>
							))}
						</CommandGroup>
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}
