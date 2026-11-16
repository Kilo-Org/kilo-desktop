import { definePlugin } from "@kilo-desktop/kernel";
import { AccountPanel } from "@kilo-desktop/plugin-shell/contracts";

import { ANACONDA_ACCOUNT_PANEL } from "../contracts";
import { AnacondaAccountRow } from "./AnacondaAccountRow";

/** kilo.anaconda's renderer entry: the Anaconda panel in Settings → Account. */
export const anacondaWebEntry = definePlugin({
	activate(sdk) {
		sdk.extensions.implement(AccountPanel, ANACONDA_ACCOUNT_PANEL, AnacondaAccountRow);
	},
});
