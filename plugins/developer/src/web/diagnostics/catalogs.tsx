import { useState, type ReactNode } from "react";

import { useKernel } from "@kilo-desktop/kernel/web";
import { Input } from "@kilo-desktop/ui/components/input";

import {
	listContextKeys,
	listDomains,
	listFlags,
	listObjectTypes,
	listPoints,
	matches,
} from "./domain-model";
import { useFlags } from "./flags";
import { useKernelChanges, useMainDomainObjects, useNavigation } from "./inspector/navigation";
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
	const entries = listDomains(kernel, useMainDomainObjects()).filter((entry) =>
		matches(entry, query),
	);
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

/** Every object type and the collection that resolves it. */
export function ObjectTypesCatalog() {
	const kernel = useKernel();
	useKernelChanges();
	const { go } = useNavigation();
	const [query, setQuery] = useState("");
	const entries = listObjectTypes(kernel, useMainDomainObjects()).filter((entry) =>
		matches(entry, query),
	);
	return (
		<Catalog noun="object types" testId="object-types" query={query} onQueryChange={setQuery}>
			{entries.map((entry) => (
				<NavigableRow
					key={entry.id}
					name={entry.id}
					testId={`diagnostics-object-type-row-${entry.id}`}
					columns={[
						<code>{entry.id}</code>,
						<code>{entry.owner}</code>,
						entry.collection ? <code>{entry.collection}</code> : "No collection",
					]}
					columnsClassName={CATALOG_COLUMNS}
					status={
						<StatusBadge
							status={
								entry.collection ? (entry.provided ? "resolved" : "unresolved") : "no collection"
							}
						/>
					}
					onOpen={() => go([{ kind: "objectType", id: entry.id }])}
				/>
			))}
		</Catalog>
	);
}

/** Every declared context key, with its value in this window. */
export function ContextKeysCatalog() {
	const kernel = useKernel();
	useKernelChanges();
	const { go } = useNavigation();
	const [query, setQuery] = useState("");
	const entries = listContextKeys(kernel).filter((entry) => matches(entry, query));
	return (
		<Catalog noun="context keys" testId="context-keys" query={query} onQueryChange={setQuery}>
			{entries.map((entry) => (
				<NavigableRow
					key={entry.id}
					name={entry.id}
					testId={`diagnostics-context-key-row-${entry.id}`}
					columns={[<code>{entry.id}</code>, <code>{entry.owner}</code>, entry.scope]}
					columnsClassName={CATALOG_COLUMNS}
					status={
						entry.pattern ? (
							<span className="text-muted-foreground text-2xs">
								{entry.values.length} {entry.values.length === 1 ? "key" : "keys"} set
							</span>
						) : (
							<StatusBadge status={entry.values[0]?.value ? "on" : "off"} />
						)
					}
					onOpen={() => go([{ kind: "contextKey", id: entry.id }])}
				/>
			))}
		</Catalog>
	);
}

const displayValue = (value: unknown) => JSON.stringify(value);

/** Every declared flag: its value and where the value came from. */
export function FlagsCatalog() {
	const flags = useFlags();
	const { go } = useNavigation();
	const [query, setQuery] = useState("");
	if (!flags) {
		return (
			<p className="text-muted-foreground text-sm" data-qa-id="diagnostics-flags-unavailable">
				Flags aren't available in this window.
			</p>
		);
	}
	const entries = listFlags(flags.flags).filter((entry) =>
		matches({ id: entry.id, owner: entry.pluginId, description: entry.description }, query),
	);
	return (
		<Catalog noun="flags" testId="flags" query={query} onQueryChange={setQuery}>
			{entries.map((entry) => (
				<NavigableRow
					key={entry.id}
					name={entry.id}
					testId={`diagnostics-flag-row-${entry.id}`}
					columns={[
						<code>{entry.id}</code>,
						<code>{entry.pluginId}</code>,
						<code data-qa-id="diagnostics-flag-value">{displayValue(entry.value)}</code>,
					]}
					columnsClassName={CATALOG_COLUMNS}
					status={<StatusBadge status={entry.origin} />}
					onOpen={() => go([{ kind: "flag", id: entry.id }])}
				/>
			))}
		</Catalog>
	);
}
