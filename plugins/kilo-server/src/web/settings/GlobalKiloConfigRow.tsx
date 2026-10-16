import { useSdk, useSdkQuery } from "@kilo-desktop/sdk-react";
import { Button } from "@kilo-desktop/ui/components/button";
import { SkeletonText } from "@kilo-desktop/ui/components/skeleton";
import { toast } from "@kilo-desktop/ui/components/sonner";
import { SummaryCard } from "@kilo-desktop/ui/components/summary-card";
import { revealInFileManagerLabel } from "@kilo-desktop/ui/lib/reveal-in-file-manager";

import type { KiloGlobalConfigFile, KiloServerService } from "../../contracts/schemas.js";

const REVEAL_FAILED_MESSAGE = "Could not show the Kilo config file";

/** Settings → About support row: where the user's global Kilo config lives. */
export function GlobalKiloConfigRow() {
	const sdk = useSdk<KiloServerService>("kilo-server");
	const configFile = useSdkQuery(sdk, "config.globalConfigFile");
	const file = configFile.data;

	const reveal = async (path: string) => {
		try {
			const { revealed } = await sdk.shell.showItemInFolder(path);
			if (!revealed) toast.error(REVEAL_FAILED_MESSAGE);
		} catch (error) {
			toast.error(REVEAL_FAILED_MESSAGE, {
				description: error instanceof Error ? error.message : "An unexpected error occurred.",
			});
		}
	};

	return (
		<SummaryCard.Row data-qa-id="about-global-kilo-config">
			<SummaryCard.Content>
				<SummaryCard.Title>Kilo config</SummaryCard.Title>
				<SummaryCard.Description>
					<GlobalConfigDescription file={file} error={configFile.error} />
				</SummaryCard.Description>
			</SummaryCard.Content>
			<SummaryCard.Actions>
				<Button
					size="sm"
					variant="outline"
					disabled={!file?.exists}
					data-qa-id="about-show-global-kilo-config"
					onClick={() => file && void reveal(file.path)}
				>
					{revealInFileManagerLabel()}
				</Button>
			</SummaryCard.Actions>
		</SummaryCard.Row>
	);
}

function GlobalConfigDescription({
	file,
	error,
}: {
	file: KiloGlobalConfigFile | undefined;
	error: Error | null;
}) {
	if (error) return error.message;
	if (!file) return <SkeletonText className="w-56" />;
	if (!file.exists) return "No global config file has been created yet.";
	return <code className="text-2xs break-all">{file.path}</code>;
}
