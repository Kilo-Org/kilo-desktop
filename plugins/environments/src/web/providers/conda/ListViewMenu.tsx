import { Button } from "@kilo-desktop/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuGroup,
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

export type SortDirection = "asc" | "desc";

const ORDER_LABELS: Record<SortDirection, string> = {
	asc: "Ascending",
	desc: "Descending",
};

export interface ListViewFilter {
	id: string;
	label: string;
	checked: boolean;
	onCheckedChange: (checked: boolean) => void;
}

interface ListViewMenuProps<Field extends string> {
	label: string;
	fields: ReadonlyArray<{ value: Field; label: string }>;
	field: Field;
	direction: SortDirection;
	onFieldChange: (field: Field) => void;
	onDirectionChange: (direction: SortDirection) => void;
	filters?: readonly ListViewFilter[];
	qaId?: string;
}

/**
 * Toolbar sort (and optional filter) menu shared by the environment list and
 * the package table. Sorting lives here rather than on column headers so the
 * list and the table read and behave the same way.
 */
export function ListViewMenu<Field extends string>({
	label,
	fields,
	field,
	direction,
	onFieldChange,
	onDirectionChange,
	filters = [],
	qaId,
}: ListViewMenuProps<Field>) {
	const fieldLabel = fields.find((entry) => entry.value === field)?.label ?? field;

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						type="button"
						variant="outline"
						size="icon-sm"
						aria-label={label}
						className="shrink-0"
						data-qa-id={qaId}
					/>
				}
			>
				<ListFilterIcon aria-hidden="true" />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-56">
				<DropdownMenuGroup>
					<DropdownMenuSub>
						<ListViewSubTrigger label="Sort by" value={fieldLabel} />
						<DropdownMenuSubContent>
							<DropdownMenuRadioGroup
								value={field}
								onValueChange={(value) => {
									const next = fields.find((entry) => entry.value === value);
									if (next) onFieldChange(next.value);
								}}
							>
								{fields.map((entry) => (
									<DropdownMenuRadioItem key={entry.value} value={entry.value} closeOnClick={false}>
										{entry.label}
									</DropdownMenuRadioItem>
								))}
							</DropdownMenuRadioGroup>
						</DropdownMenuSubContent>
					</DropdownMenuSub>
					<DropdownMenuSub>
						<ListViewSubTrigger label="Order" value={ORDER_LABELS[direction]} />
						<DropdownMenuSubContent>
							<DropdownMenuRadioGroup
								value={direction}
								onValueChange={(value) => {
									if (value === "asc" || value === "desc") onDirectionChange(value);
								}}
							>
								<DropdownMenuRadioItem value="asc" closeOnClick={false}>
									Ascending
								</DropdownMenuRadioItem>
								<DropdownMenuRadioItem value="desc" closeOnClick={false}>
									Descending
								</DropdownMenuRadioItem>
							</DropdownMenuRadioGroup>
						</DropdownMenuSubContent>
					</DropdownMenuSub>
				</DropdownMenuGroup>
				{filters.length > 0 ? (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuGroup>
							<DropdownMenuLabel>Show</DropdownMenuLabel>
							{filters.map((filter) => (
								<DropdownMenuCheckboxItem
									key={filter.id}
									checked={filter.checked}
									closeOnClick={false}
									onCheckedChange={(checked) => filter.onCheckedChange(checked === true)}
								>
									{filter.label}
								</DropdownMenuCheckboxItem>
							))}
						</DropdownMenuGroup>
					</>
				) : null}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function ListViewSubTrigger({ label, value }: { label: string; value: string }) {
	return (
		<DropdownMenuSubTrigger className="w-full">
			<span className="flex min-w-0 flex-1 items-center gap-1.5">
				<span>{label}</span>
				<span className="text-muted-foreground ml-auto">{value}</span>
			</span>
		</DropdownMenuSubTrigger>
	);
}
