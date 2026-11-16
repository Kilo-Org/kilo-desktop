import { useDomainObjectState } from "@kilo-desktop/kernel/web";
import type {
	PermissionDetailProps,
	PermissionRendererImplementation,
} from "@kilo-desktop/plugin-chat/contracts";
import { Panes, type WorkSessionPanes } from "@kilo-desktop/plugin-work-sessions/contracts";

import { NOTEBOOK_PANE_KIND, notebookFileOf, notebookIdOf } from "../contracts";

function asRecord(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function numberList(value: unknown): number[] {
	return Array.isArray(value)
		? value.filter((item): item is number => Number.isInteger(item) && item > 0)
		: [];
}

/** The open notebook's file, or its tab title while it is unsaved. */
function notebookLabel(
	byWorkSession: Readonly<Record<string, WorkSessionPanes>>,
	notebookId: string,
): string | undefined {
	for (const { panes } of Object.values(byWorkSession)) {
		const pane = panes.find(
			(candidate) =>
				candidate.kind === NOTEBOOK_PANE_KIND && notebookIdOf(candidate) === notebookId,
		);
		if (pane) return notebookFileOf(pane) ?? pane.title;
	}
	return undefined;
}

const ROW_CLASS =
	"border-input dark:bg-input/20 flex min-w-0 gap-2 rounded-lg border bg-transparent px-3 py-2.5 text-sm";

function DetailRow({
	label,
	value,
	qaId,
}: {
	readonly label: string;
	readonly value: string;
	readonly qaId: string;
}) {
	return (
		<div className={ROW_CLASS} data-qa-id={qaId}>
			<span className="text-muted-foreground shrink-0">{label}</span>
			<span className="min-w-0 font-mono break-all">{value}</span>
		</div>
	);
}

function NotebookName({ notebookId }: { readonly notebookId: string }) {
	const label = useDomainObjectState(Panes, (state) =>
		notebookLabel(state.byWorkSession, notebookId),
	);
	return label ? (
		<DetailRow label="Notebook" value={label} qaId="notebook-execute-notebook" />
	) : null;
}

/**
 * The cells an execute request runs, by their place in the notebook (main
 * numbers them; ids mean nothing to a person). A run of all cells is counted.
 */
function CellsRow({ metadata }: { readonly metadata: Readonly<Record<string, unknown>> }) {
	if (metadata.action !== "execute") return null;
	const numbers = numberList(metadata.cell_numbers);
	if (metadata.all_cells === true) {
		const count = numbers.length;
		return (
			<DetailRow
				label="Cells"
				value={`All ${count} code cell${count === 1 ? "" : "s"}`}
				qaId="notebook-execute-cells"
			/>
		);
	}
	if (numbers.length === 0) return null;
	return (
		<DetailRow
			label={numbers.length === 1 ? "Cell" : "Cells"}
			value={numbers.join(", ")}
			qaId="notebook-execute-cells"
		/>
	);
}

function CodeBlock({ args }: { readonly args: Record<string, unknown> }) {
	const code = [args.code, args.source].find(
		(value): value is string => typeof value === "string" && value.length > 0,
	);
	if (!code) return null;
	return (
		<pre
			className="border-input dark:bg-input/20 max-h-64 min-w-0 overflow-auto rounded-lg border bg-transparent px-3 py-2.5 font-mono text-xs whitespace-pre"
			data-qa-id="notebook-execute-code"
		>
			{code}
		</pre>
	);
}

/**
 * Which notebook a `notebooks_execute` request is for (its file, in place of
 * the id the request's pattern carries) and what it will run: the code of a
 * `run_cell` or `create_cell` call, or the numbers of the cells `execute` runs.
 */
export function NotebookExecutionDetail({ request }: PermissionDetailProps) {
	const args = asRecord(request.args);
	const notebookId = typeof args.notebook_id === "string" ? args.notebook_id : undefined;
	return (
		<div className="grid min-w-0 gap-2 empty:hidden">
			{notebookId ? <NotebookName notebookId={notebookId} /> : null}
			<CellsRow metadata={request.metadata} />
			<CodeBlock args={args} />
		</div>
	);
}

/** The notebook code permission card. */
export const notebookExecuteInteractions: PermissionRendererImplementation = {
	PermissionDetail: NotebookExecutionDetail,
	// The pattern is a session-and-notebook key, kept so "Always allow" lasts for this notebook in this session.
	showPatterns: () => false,
};
