import { describe, expect, it } from "vitest";

import { workSessionFolders } from "../../contracts";
import { relativePanePath } from "./pane-path";

const APP = [{ path: "/projects/app", isPrimary: true }];

describe("a pane's relative path", () => {
	it("is the path inside the session folder holding the file", () => {
		expect(relativePanePath("/projects/app/src/a.ts", APP)).toBe("src/a.ts");
	});

	it("keeps a Windows folder's separators", () => {
		const folders = [{ path: "C:\\repo", isPrimary: true }];
		expect(relativePanePath("C:\\repo\\src\\a.ts", folders)).toBe("src\\a.ts");
	});

	it("is the deepest folder's, when folders nest", () => {
		const folders = [...APP, { path: "/projects/app/packages/lib", isPrimary: false }];
		expect(relativePanePath("/projects/app/packages/lib/x.ts", folders)).toBe("x.ts");
	});

	it("is inside the session's worktree, which stands in for the primary folder", () => {
		const folders = workSessionFolders(APP, "/worktrees/feature");
		expect(relativePanePath("/worktrees/feature/src/a.ts", folders)).toBe("src/a.ts");
	});

	it("falls back to the absolute path outside every folder, or for a folder itself", () => {
		expect(relativePanePath("/elsewhere/b.ts", APP)).toBe("/elsewhere/b.ts");
		expect(relativePanePath("/projects/app", APP)).toBe("/projects/app");
		expect(relativePanePath("/projects/app/a.ts", [])).toBe("/projects/app/a.ts");
	});
});
