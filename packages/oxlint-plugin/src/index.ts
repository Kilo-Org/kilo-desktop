import { definePlugin } from "@oxlint/plugins";

import noComponentInFactory from "./rules/no-component-in-factory.ts";
import noHooklessUseFunction from "./rules/no-hookless-use-function.ts";
import noManualMemo from "./rules/no-manual-memo.ts";

export default definePlugin({
	meta: { name: "kilo" },
	rules: {
		"no-component-in-factory": noComponentInFactory,
		"no-hookless-use-function": noHooklessUseFunction,
		"no-manual-memo": noManualMemo,
	},
});
