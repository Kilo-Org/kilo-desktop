import { useMemo } from "react";

import { Button } from "@kilo-desktop/ui/components/button";
import {
	Combobox,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxInput,
	ComboboxItem,
	ComboboxList,
	ComboboxTrigger,
	ComboboxValue,
} from "@kilo-desktop/ui/components/combobox";

/** Sentinel for the "Latest" choice (caller omits an explicit python spec). */
export const PYTHON_LATEST = "__latest__";

interface PythonVersionPickerProps {
	/** Current value: `PYTHON_LATEST` or a concrete version string. */
	value: string;
	/** Available versions, newest first (patch-level, e.g. `3.12.4`). */
	versions: string[];
	onChange: (value: string) => void;
}

function versionLabel(value: string): string {
	return value === PYTHON_LATEST ? "Latest" : value;
}

/**
 * Searchable Python-version picker. A full repodata version list runs to
 * dozens of entries, so this is a combobox with its search input inside the
 * popup rather than a plain select.
 */
export function PythonVersionPicker({ value, versions, onChange }: PythonVersionPickerProps) {
	const items = useMemo(() => [PYTHON_LATEST, ...versions], [versions]);

	return (
		<Combobox
			items={items}
			value={value}
			onValueChange={(next) => {
				if (next) onChange(next);
			}}
			itemToStringLabel={versionLabel}
		>
			<ComboboxTrigger
				render={
					<Button
						type="button"
						variant="outline"
						aria-label="Python version"
						className="w-full justify-between font-normal"
						data-qa-id="environments-create-python"
					/>
				}
			>
				<ComboboxValue />
			</ComboboxTrigger>
			<ComboboxContent>
				<ComboboxInput
					showTrigger={false}
					placeholder="Search versions"
					data-qa-id="environments-create-python-search"
				/>
				<ComboboxEmpty>No matching versions.</ComboboxEmpty>
				<ComboboxList className="scroll-fade-y">
					{(item: string) => (
						<ComboboxItem key={item} value={item}>
							{versionLabel(item)}
						</ComboboxItem>
					)}
				</ComboboxList>
			</ComboboxContent>
		</Combobox>
	);
}
