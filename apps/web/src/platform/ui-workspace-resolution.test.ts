import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

describe("UI workspace resolution", () => {
	it("resolves the shared UI package to live workspace source", () => {
		const requireFromWebApp = createRequire(new URL("../../package.json", import.meta.url));
		const resolvedSidebar = realpathSync(
			requireFromWebApp.resolve("@kilo-desktop/ui/components/sidebar"),
		);
		const workspaceSidebar = fileURLToPath(
			new URL("../../../../packages/ui/src/components/sidebar.tsx", import.meta.url),
		);

		expect(resolvedSidebar).toBe(workspaceSidebar);
	});
});
