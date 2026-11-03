import { definePlugin } from "@kilo-desktop/kernel";
import { AccountPanel } from "@kilo-desktop/plugin-account/contracts";

import { AnacondaAccountRow } from "./AnacondaAccountRow.js";

export { AnacondaAccountRow } from "./AnacondaAccountRow.js";

/** kilo.anaconda-account's renderer entry: the Anaconda row in Settings → Account. */
export const anacondaAccountWebEntry = definePlugin({
	activate(sdk) {
		sdk.extensions.implement(AccountPanel, "anaconda", AnacondaAccountRow);
	},
});
