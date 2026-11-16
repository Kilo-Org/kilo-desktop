import { RenderContribution, useExtensions } from "@kilo-desktop/kernel/web";

import { Dialog, type DialogProps } from "../../contracts";
import { useOpenDialogs, useShellUi } from "./ui-state";

/**
 * The `kilo.shell/dialog` contributions this window was asked to open
 * (`navigation.openDialog`), each mounted only while it is open. A dialog
 * whose contribution goes away (its plugin stops, its `when` fails) is gone
 * from the window too.
 */
export function DialogsHost() {
	const ui = useShellUi();
	const open = useOpenDialogs();
	const dialogs = useExtensions(Dialog);

	return open.map(({ key, input }) => {
		const dialog = dialogs.find((candidate) => candidate.key === key);
		if (!dialog) return null;
		const props: DialogProps = { close: () => ui.closeDialog(key), input };
		return <RenderContribution key={key} contribution={dialog} props={props} />;
	});
}
