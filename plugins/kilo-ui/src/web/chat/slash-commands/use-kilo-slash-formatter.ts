import { useMemo } from "react";

import { useChatConnection } from "../connection/ChatConnectionContext.js";
import { useWorkspaceDirectory } from "../../session/workspace/use-workspace-directory.js";
import { createKiloSlashFormatter, slashSourceCategory } from "./kilo-slash-command.js";
import { useKiloCommandCatalog } from "./use-kilo-command-catalog.js";

export function useKiloSlashFormatter() {
	const { connection } = useChatConnection();
	const workspaceDirectory = useWorkspaceDirectory();
	const directory = workspaceDirectory ?? connection?.globalDirectory;
	const catalog = useKiloCommandCatalog(connection, directory);
	return useMemo(
		() =>
			createKiloSlashFormatter(
				new Map(
					(catalog.data ?? []).map((command) => [
						command.name,
						slashSourceCategory(command.source),
					]),
				),
			),
		[catalog.data],
	);
}
