import type { ComponentProps, ReactNode } from "react";

import {
	Table,
	TableBody,
	TableHead,
	TableHeader,
	TableRow,
} from "@kilo-desktop/ui/components/table";

// Shared by the loaded table and its loading skeleton so both keep the same
// column widths and container-query breakpoints.
export const catalogTableCellClassNames = {
	model: "max-w-md overflow-hidden whitespace-normal",
	capabilities: "hidden overflow-hidden whitespace-normal @xl:table-cell",
	performance: "overflow-hidden whitespace-normal",
} as const;

export function ModelCatalogTableFrame({
	children,
	...props
}: Omit<ComponentProps<"div">, "className"> & { children: ReactNode }) {
	return (
		<div
			className="border-border min-w-0 overflow-hidden rounded-lg border [&_[data-slot=table-container]]:overflow-x-hidden"
			{...props}
		>
			<Table className="table-fixed">
				<TableHeader>
					<TableRow>
						<TableHead scope="col" className="w-[55%] @xl:w-[44%]">
							Model
						</TableHead>
						<TableHead scope="col" className="hidden w-[20%] whitespace-normal @xl:table-cell">
							Capabilities
						</TableHead>
						<TableHead scope="col" className="w-[45%] whitespace-normal @xl:w-[36%]">
							<span className="@xl:hidden">Performance</span>
							<span className="hidden @xl:inline">Estimated performance</span>
						</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>{children}</TableBody>
			</Table>
		</div>
	);
}
