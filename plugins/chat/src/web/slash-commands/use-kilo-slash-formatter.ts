import { useMemo } from "react";

import { createKiloSlashFormatter, type SlashCategory } from "./kilo-slash-command";
import type { SlashMenuCommand } from "./merge-slash-commands";

/** Shows the leading `/name` of a known command (or a client command's alias) as a chip. */
export function useKiloSlashFormatter(commands: readonly SlashMenuCommand[]) {
	return useMemo(() => {
		const known = new Map<string, SlashCategory>();
		for (const command of commands) {
			known.set(command.id, command.category);
			for (const alias of command.aliases) {
				if (!known.has(alias)) known.set(alias, command.category);
			}
		}
		return createKiloSlashFormatter(known);
	}, [commands]);
}
