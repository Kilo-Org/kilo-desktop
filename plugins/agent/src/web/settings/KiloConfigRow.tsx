import { useEffect, useState } from "react";

import { KernelShell } from "@kilo-desktop/kernel";
import { useDomain } from "@kilo-desktop/kernel/web";
import { Button } from "@kilo-desktop/ui/components/button";
import { SkeletonText } from "@kilo-desktop/ui/components/skeleton";
import { toast } from "@kilo-desktop/ui/components/sonner";
import { SummaryCard } from "@kilo-desktop/ui/components/summary-card";
import { revealInFileManagerLabel } from "@kilo-desktop/ui/lib/reveal-in-file-manager";

import { AgentConfig, type UserConfigFile } from "../../contracts";

const REVEAL_FAILED_MESSAGE = "Could not show the Kilo config file";

type ConfigFileState =
	| { readonly kind: "loading" }
	| { readonly kind: "loaded"; readonly file: UserConfigFile }
	| { readonly kind: "failed"; readonly message: string };

function useUserConfigFile(): ConfigFileState {
	const config = useDomain(AgentConfig);
	const [state, setState] = useState<ConfigFileState>({ kind: "loading" });

	useEffect(() => {
		if (!config) return;
		let active = true;
		config.methods
			.userConfigFile(undefined)
			.then((file) => active && setState({ kind: "loaded", file }))
			.catch(
				(error: unknown) =>
					active &&
					setState({
						kind: "failed",
						message: error instanceof Error ? error.message : "The Kilo config could not be found.",
					}),
			);
		return () => {
			active = false;
		};
	}, [config]);

	return state;
}

/** Settings → About → Support row: where the user's global Kilo config lives. */
export function KiloConfigRow() {
	const shell = useDomain(KernelShell);
	const state = useUserConfigFile();
	const file = state.kind === "loaded" ? state.file : undefined;

	const reveal = async (path: string) => {
		try {
			await shell?.methods.showItemInFolder({ path });
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
					{state.kind === "failed" ? (
						state.message
					) : !file ? (
						<SkeletonText className="w-56" />
					) : !file.exists ? (
						"No global config file has been created yet."
					) : (
						<code className="text-2xs break-all">{file.path}</code>
					)}
				</SummaryCard.Description>
			</SummaryCard.Content>
			<SummaryCard.Actions>
				<Button
					size="sm"
					variant="outline"
					disabled={!file?.exists || !shell}
					data-qa-id="about-show-global-kilo-config"
					onClick={() => file && void reveal(file.path)}
				>
					{revealInFileManagerLabel()}
				</Button>
			</SummaryCard.Actions>
		</SummaryCard.Row>
	);
}
