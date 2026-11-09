import { definePlugin } from "@kilo-desktop/kernel";
import { AccountPanel } from "@kilo-desktop/plugin-shell/contracts";

import { AnacondaAccountRow } from "./AnacondaAccountRow.js";

/** kilo.anaconda-account's renderer entry: the Anaconda panel in Settings → Account. */
export const anacondaAccountWebEntry = definePlugin({
	activate(sdk) {
		sdk.extensions.implement(AccountPanel, "anaconda", AnacondaAccountRow);
	},
});
