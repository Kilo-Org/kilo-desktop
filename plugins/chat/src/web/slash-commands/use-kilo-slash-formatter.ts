import { useMemo } from "react";

import { useChatConnection } from "../runtime/chat-connection";
import { createKiloSlashFormatter, slashSourceCategory } from "./kilo-slash-command";
import { useKiloCommandCatalog } from "./use-kilo-command-catalog";

/** Shows the leading `/name` of a known command as a chip. */
export function useKiloSlashFormatter(directory: string | null) {
	const { connection } = useChatConnection();
	const catalog = useKiloCommandCatalog(connection, directory ?? undefined);
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
