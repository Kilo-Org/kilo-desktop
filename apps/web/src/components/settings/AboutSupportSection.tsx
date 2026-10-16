import { useEffect, useState, type ComponentType } from "react";

import { SETTINGS_ABOUT_SUPPORT_ZONE } from "@kilo-desktop/feature-sdk";
import { useSdkContributions } from "@kilo-desktop/sdk-react";
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

import { useLocalApi } from "@/platform/LocalApiProvider";

/**
 * Settings → About "Support" card: the application log row plus any rows
 * plugins contribute to `settings-about-support`. Each row sits in its own
 * wrapper because `SummaryCard.Row` sets `border-0`, which would otherwise
 * cancel the card's `divide-y` separators.
 */
export function AboutSupportSection() {
	const api = useLocalApi();
	const canShowLogFile = api.shell.canShowLogFile;
	const contributions = useSdkContributions(SETTINGS_ABOUT_SUPPORT_ZONE).filter(
		(contribution) => typeof contribution.component === "function",
	);
	if (!canShowLogFile && contributions.length === 0) return null;

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
				{canShowLogFile ? (
					<div data-qa-id="about-logs">
						<ApplicationLogsRow />
					</div>
				) : null}
				{contributions.map((contribution) => {
					const Row = contribution.component as ComponentType;
					return (
						<div key={`${contribution.featureId}:${contribution.id}`}>
							<Row />
						</div>
					);
				})}
			</section>
		</FieldSet>
	);
}

const REVEAL_LOG_FAILED_MESSAGE = "Could not show the application log file";

function ApplicationLogsRow() {
	const api = useLocalApi();
	const logFilePath = useLogFilePath();

	const showLogFile = async () => {
		try {
			const { revealed } = await api.shell.showLogFile();
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
function useLogFilePath(): string | null | undefined {
	const api = useLocalApi();
	const [path, setPath] = useState<string | null | undefined>(undefined);

	useEffect(() => {
		let active = true;
		api.shell
			.getLogFilePath()
			.then((result) => {
				if (active) setPath(result.path);
			})
			.catch(() => {
				if (active) setPath(null);
			});
		return () => {
			active = false;
		};
	}, [api]);

	return path;
}
