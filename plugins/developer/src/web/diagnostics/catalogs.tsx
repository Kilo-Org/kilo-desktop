import { useState, type ReactNode } from "react";

import { useKernel } from "@kilo-desktop/kernel/web";
import { Input } from "@kilo-desktop/ui/components/input";

import { listDomains, listPoints, matches } from "./domain-model";
import { useKernelChanges, useNavigation } from "./inspector/navigation";
import { CATALOG_COLUMNS, NavigableRow, Panel, StatusBadge } from "./parts";

/** A filter box over a list of rows, or a note when nothing matches. */
function Catalog({
	noun,
	testId,
	query,
	onQueryChange,
	children,
}: {
	readonly noun: string;
	readonly testId: string;
	readonly query: string;
	readonly onQueryChange: (query: string) => void;
	readonly children: readonly ReactNode[];
}) {
	return (
		<div className="flex min-w-0 flex-col gap-3">
			<Input
				type="search"
				placeholder={`Filter ${noun} by id, owner or description`}
				aria-label={`Filter ${noun}`}
				data-qa-id={`diagnostics-filter-${testId}`}
				value={query}
				onChange={(event) => onQueryChange(event.target.value)}
			/>
			{children.length > 0 ? (
				<Panel testId={`diagnostics-${testId}`}>{children}</Panel>
			) : (
				<p className="text-muted-foreground text-sm" data-qa-id={`diagnostics-no-${testId}`}>
					No {noun} match “{query}”.
				</p>
			)}
		</div>
	);
}

/** Every extension point, the kernel's and plugins'. */
export function PointsCatalog() {
	const kernel = useKernel();
	const { go } = useNavigation();
	const [query, setQuery] = useState("");
	const entries = listPoints(kernel).filter((entry) => matches(entry, query));
	return (
		<Catalog noun="extension points" testId="points" query={query} onQueryChange={setQuery}>
			{entries.map((entry) => (
				<NavigableRow
					key={entry.id}
					name={entry.id}
					testId={`diagnostics-point-row-${entry.id}`}
					columns={[<code>{entry.id}</code>, <code>{entry.owner}</code>, entry.kind]}
					columnsClassName={CATALOG_COLUMNS}
					status={
						<span className="text-muted-foreground text-2xs">
							{entry.contributions} {entry.contributions === 1 ? "contribution" : "contributions"}
						</span>
					}
					onOpen={() => go([{ kind: "point", id: entry.id }])}
				/>
			))}
		</Catalog>
	);
}

/** Every domain object, the kernel's and plugins', and whether it is provided. */
export function DomainsCatalog() {
	const kernel = useKernel();
	useKernelChanges();
	const { go } = useNavigation();
	const [query, setQuery] = useState("");
	const entries = listDomains(kernel).filter((entry) => matches(entry, query));
	return (
		<Catalog noun="domain objects" testId="domains" query={query} onQueryChange={setQuery}>
			{entries.map((entry) => (
				<NavigableRow
					key={entry.id}
					name={entry.id}
					testId={`diagnostics-domain-row-${entry.id}`}
					columns={[<code>{entry.id}</code>, <code>{entry.owner}</code>, entry.home]}
					columnsClassName={CATALOG_COLUMNS}
					status={<StatusBadge status={entry.provided ? "provided" : "not provided"} />}
					onOpen={() => go([{ kind: "domain", id: entry.id }])}
				/>
			))}
		</Catalog>
	);
}
