// Runs in every window, inside the app's React tree. React, the kernel and
// some @kilo-desktop/ui components come from the app (see
// docs/plugins/local-plugins.md); write JSX and bundle it, or call `jsx`
// directly as here.
import { jsx, jsxs } from "react/jsx-runtime";
import { definePlugin, KernelCommand } from "@kilo-desktop/kernel";
import { useDomainObject, useDomainObjectState } from "@kilo-desktop/kernel/web";
import { Button } from "@kilo-desktop/ui/components/button";

import { Counter } from "./contracts.js";

/** Another plugin's extension point, referenced by id (the kernel matches points by id). */
const SettingsSection = { id: "kilo.shell/settings-section" };

const selectCount = (state) => state.count;

function HelloPage() {
	const counter = useDomainObject(Counter);
	const count = useDomainObjectState(Counter, selectCount);
	return jsxs("div", {
		className: "flex flex-col items-start gap-3 p-1",
		"data-qa-id": "local-hello-page",
		children: [
			jsx("p", {
				className: "text-sm",
				"data-qa-id": "local-hello-count",
				children: `Counted ${count ?? 0} times.`,
			}),
			jsx(Button, {
				"data-qa-id": "local-hello-increment",
				onClick: () => void counter?.methods.increment(undefined),
				children: "Count one more",
			}),
		],
	});
}

export default definePlugin({
	activate(sdk) {
		sdk.extensions.implement(SettingsSection, "local-hello", { component: HelloPage });
		sdk.extensions.implement(KernelCommand, "increment", async () => {
			await sdk.domainObjects.get(Counter)?.methods.increment(undefined);
		});
	},
});
