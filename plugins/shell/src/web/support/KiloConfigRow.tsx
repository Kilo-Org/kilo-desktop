import { useEffect, useState } from "react";

import { KernelOs } from "@kilo-desktop/kernel";
import { useDomainObject } from "@kilo-desktop/kernel/web";
import { KiloServer, type UserConfigFile } from "@kilo-desktop/plugin-core/contracts";
import { Button } from "@kilo-desktop/ui/components/button";
import { SkeletonText } from "@kilo-desktop/ui/components/skeleton";
import { SummaryCard } from "@kilo-desktop/ui/components/summary-card";
import { revealInFileManagerLabel } from "@kilo-desktop/ui/lib/reveal-in-file-manager";

import { Notifications } from "../../contracts";

const REVEAL_FAILED_MESSAGE = "Could not show the Kilo config file";

type ConfigFileState =
	| { readonly kind: "loading" }
	| { readonly kind: "loaded"; readonly file: UserConfigFile }
	| { readonly kind: "failed"; readonly message: string };

function useUserConfigFile(): ConfigFileState {
	const server = useDomainObject(KiloServer);
	const [state, setState] = useState<ConfigFileState>({ kind: "loading" });

	useEffect(() => {
		if (!server) return;
		let active = true;
		server.methods
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
	}, [server]);

	return state;
}

/** Settings → About → Support row: where the user's global Kilo config lives. */
export function KiloConfigRow() {
	const os = useDomainObject(KernelOs);
	const notifications = useDomainObject(Notifications);
	const state = useUserConfigFile();
	const file = state.kind === "loaded" ? state.file : undefined;

	const reveal = async (path: string) => {
		try {
			await os?.methods.showItemInFolder({ path });
		} catch (error) {
			await notifications?.methods
				.toast({
					level: "error",
					title: REVEAL_FAILED_MESSAGE,
					description: error instanceof Error ? error.message : "An unexpected error occurred.",
				})
				.catch(() => undefined);
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
					disabled={!file?.exists || !os}
					data-qa-id="about-show-global-kilo-config"
					onClick={() => file && void reveal(file.path)}
				>
					{revealInFileManagerLabel()}
				</Button>
			</SummaryCard.Actions>
		</SummaryCard.Row>
	);
}
