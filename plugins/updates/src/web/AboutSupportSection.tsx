import { useEffect, useState } from "react";

import { KernelShell } from "@kilo-desktop/kernel";
import {
	RenderContribution,
	useContextKey,
	useDomain,
	useExtensions,
} from "@kilo-desktop/kernel/web";
import { Button } from "@kilo-desktop/ui/components/button";
import {
	FieldContent,
	FieldDescription,
	FieldLegend,
	FieldSet,
} from "@kilo-desktop/ui/components/field";
import { SkeletonText } from "@kilo-desktop/ui/components/skeleton";
import { toast } from "@kilo-desktop/ui/components/sonner";
import { SummaryCard } from "@kilo-desktop/ui/components/summary-card";
import { revealInFileManagerLabel } from "@kilo-desktop/ui/lib/reveal-in-file-manager";

import { SupportRow } from "../contracts";

type Shell = NonNullable<ReturnType<typeof useDomain<typeof KernelShell>>>;

/**
 * Settings → About "Support" card: the application log row (desktop only)
 * plus rows other plugins contribute to `kilo.updates/support-row`. Each row
 * sits in its own wrapper because `SummaryCard.Row` sets `border-0`, which
 * would otherwise cancel the card's `divide-y` separators.
 */
export function AboutSupportSection() {
	const shell = useDomain(KernelShell);
	const desktop = useContextKey("kernel/desktop");
	const rows = useExtensions(SupportRow);
	const logsShell = desktop ? shell : null;
	if (!logsShell && rows.length === 0) return null;

	return (
		<FieldSet
			className="min-w-0"
			aria-labelledby="about-support-heading"
			data-qa-id="about-support"
		>
			<FieldContent>
				<FieldLegend id="about-support-heading" variant="label" className="mb-0">
					Support
				</FieldLegend>
				<FieldDescription>Information to include when you contact support.</FieldDescription>
			</FieldContent>
			<section className="border-border bg-card divide-border min-w-0 divide-y overflow-hidden rounded-lg border">
				{logsShell ? (
					<div data-qa-id="about-logs">
						<ApplicationLogsRow shell={logsShell} />
					</div>
				) : null}
				{rows.map((row) => (
					<div key={row.key}>
						<RenderContribution contribution={row} />
					</div>
				))}
			</section>
		</FieldSet>
	);
}

const REVEAL_LOG_FAILED_MESSAGE = "Could not show the application log file";

function ApplicationLogsRow({ shell }: { readonly shell: Shell }) {
	const logFilePath = useLogFilePath(shell);

	const showLogFile = async () => {
		try {
			const { revealed } = await shell.methods.showLogs(undefined);
			if (!revealed) toast.error(REVEAL_LOG_FAILED_MESSAGE);
		} catch (error) {
			toast.error(REVEAL_LOG_FAILED_MESSAGE, {
				description: error instanceof Error ? error.message : "An unexpected error occurred.",
			});
		}
	};

	return (
		<SummaryCard.Row>
			<SummaryCard.Content>
				<SummaryCard.Title>Application logs</SummaryCard.Title>
				{logFilePath === null ? null : (
					<SummaryCard.Description>
						{logFilePath === undefined ? (
							<SkeletonText className="w-56" />
						) : (
							<code className="text-2xs break-all">{logFilePath}</code>
						)}
					</SummaryCard.Description>
				)}
			</SummaryCard.Content>
			<SummaryCard.Actions>
				<Button
					size="sm"
					variant="outline"
					data-qa-id="about-show-log-file"
					onClick={() => void showLogFile()}
				>
					{revealInFileManagerLabel()}
				</Button>
			</SummaryCard.Actions>
		</SummaryCard.Row>
	);
}

/**
 * `undefined` while loading; `null` when the read fails — the path is
 * display-only, so a failure just leaves it out.
 */
function useLogFilePath(shell: Shell): string | null | undefined {
	const [path, setPath] = useState<string | null | undefined>(undefined);

	useEffect(() => {
		let active = true;
		shell.methods
			.logFilePath(undefined)
			.then((result) => {
				if (active) setPath(result);
			})
			.catch(() => {
				if (active) setPath(null);
			});
		return () => {
			active = false;
		};
	}, [shell]);

	return path;
}
