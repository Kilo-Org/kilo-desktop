import type { TextMessagePartComponent } from "@assistant-ui/react";
import { useMemo } from "react";

import { useChatConnection } from "../../connection/ChatConnectionContext.js";
import { useWorkspaceDirectory } from "../../use-workspace-directory.js";
import { slashDisplayText } from "../../slash-commands/kilo-slash-command.js";
import { SLASH_CATEGORY_ICONS } from "../../slash-commands/kilo-slash-icons.js";
import { useKiloCommandCatalog } from "../../slash-commands/use-kilo-command-catalog.js";
import { useKiloSlashFormatter } from "../../slash-commands/use-kilo-slash-formatter.js";
import { createDirectiveText } from "./elements/directive-text.aui.js";

export const KiloDirectiveText: TextMessagePartComponent = (props) => {
	const formatter = useKiloSlashFormatter();
	const { connection } = useChatConnection();
	const workspaceDirectory = useWorkspaceDirectory();
	const directory = workspaceDirectory ?? connection?.globalDirectory;
	const catalog = useKiloCommandCatalog(connection, directory);
	const text = useMemo(
		() => slashDisplayText(props.text, catalog.data ?? []),
		[catalog.data, props.text],
	);
	const Text = useMemo(
		() => createDirectiveText(formatter, { iconMap: SLASH_CATEGORY_ICONS }),
		[formatter],
	);
	return <Text {...props} text={text} />;
};
