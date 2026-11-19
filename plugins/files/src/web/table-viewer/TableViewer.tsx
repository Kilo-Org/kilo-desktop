import { CircleAlertIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { Spinner } from "@kilo-desktop/ui/components/spinner";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@kilo-desktop/ui/components/empty";

import {
	loadSiftRuntime,
	type SiftLoadState,
	type SiftRuntime,
	type SiftTableSource,
} from "./sift-runtime.js";

export interface TableViewerProps {
	readonly source: SiftTableSource;
	readonly fileName: string;
	/** Recovery actions shown with a load/parse error (e.g. switch to Edit). */
	readonly errorActions?: ReactNode;
}

interface SourceReport {
	readonly source: SiftTableSource;
	readonly loadState: SiftLoadState;
	readonly error: string | null;
}

type RuntimeState =
	| { readonly status: "loading" }
	| { readonly status: "ready"; readonly runtime: SiftRuntime }
	| { readonly status: "failed" };

export function TableError({
	title,
	message,
	actions,
}: {
	readonly title: string;
	readonly message: string;
	readonly actions?: ReactNode;
}) {
	return (
		<Empty data-qa-id="files-table-error" role="alert">
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<CircleAlertIcon aria-hidden="true" />
				</EmptyMedia>
				<EmptyTitle>{title}</EmptyTitle>
				<EmptyDescription>{message}</EmptyDescription>
			</EmptyHeader>
			{actions ? <EmptyContent>{actions}</EmptyContent> : null}
		</Empty>
	);
}

/**
 * Hosts Sift for one complete table source. Load and parse failures surface as
 * an alert (the source text/bytes are untouched, so an editor draft survives),
 * and reports are keyed by source identity so a late report for a previous
 * source never applies to the current one. Runtime results that land after
 * unmount are dropped so a reopened tab never shows a stale table.
 */
export function TableViewer({ source, fileName, errorActions }: TableViewerProps) {
	const [runtimeState, setRuntimeState] = useState<RuntimeState>({ status: "loading" });
	const [report, setReport] = useState<SourceReport>({ source, loadState: "loading", error: null });
	const current = report.source === source ? report : null;
	const loadState = current?.loadState ?? "loading";
	const tableError = current?.error ?? null;
	const setLoadState = (next: SiftLoadState) =>
		setReport((previous) => ({
			source,
			loadState: next,
			error: previous.source === source ? previous.error : null,
		}));
	const setTableError = (message: string) =>
		setReport((previous) => ({
			source,
			loadState: previous.source === source ? previous.loadState : "loading",
			error: message,
		}));

	useEffect(() => {
		let mounted = true;
		loadSiftRuntime().then(
			(runtime) => {
				if (mounted) setRuntimeState({ status: "ready", runtime });
			},
			() => {
				if (mounted) setRuntimeState({ status: "failed" });
			},
		);
		return () => {
			mounted = false;
		};
	}, []);

	if (runtimeState.status === "failed") {
		return (
			<TableError
				actions={errorActions}
				message="The table viewer failed to load."
				title="Could not show this table"
			/>
		);
	}
	if (tableError) {
		return (
			<TableError actions={errorActions} message={tableError} title="Could not show this table" />
		);
	}

	const TableView = runtimeState.status === "ready" ? runtimeState.runtime.TableView : null;
	const busy = TableView === null || loadState === "loading";
	return (
		<section
			aria-busy={busy}
			aria-label={`Table view of ${fileName}`}
			className="flex min-h-0 min-w-0 flex-1 flex-col"
			data-qa-id="files-table-view"
		>
			{busy ? (
				<div
					aria-live="polite"
					className="text-muted-foreground flex items-center gap-2 px-3 py-2 text-xs"
					data-qa-id="files-table-loading"
					role="status"
				>
					<Spinner aria-hidden="true" />
					Loading table…
				</div>
			) : null}
			{TableView ? (
				<TableView
					ariaLabel={fileName}
					onError={setTableError}
					onLoadStateChange={setLoadState}
					source={source}
				/>
			) : null}
		</section>
	);
}
