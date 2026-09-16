import { describe, expect, it } from "vitest";

import { createKiloSlashFormatter } from "../../slash-commands/kilo-slash-command.js";
import {
	kiloFileMentionFormatter,
	resolveFileMention,
	withFileMentions,
} from "./kilo-file-mention-formatter.js";

describe("Kilo file mention formatter", () => {
	it("parses file mentions in ordinary text", () => {
		expect(kiloFileMentionFormatter.parse("Review @/src/App.tsx next")).toEqual([
			{ kind: "text", text: "Review " },
			{ kind: "mention", type: "file", id: "src/App.tsx", label: "App.tsx" },
			{ kind: "text", text: " next" },
		]);
	});

	it("preserves slash chips while parsing file mentions in command arguments", () => {
		const formatter = withFileMentions(createKiloSlashFormatter(new Map([["review", "command"]])));
		expect(formatter.parse("/review @/src/App.tsx")).toEqual([
			{ kind: "mention", type: "command", id: "review", label: "review" },
			{ kind: "text", text: " " },
			{ kind: "mention", type: "file", id: "src/App.tsx", label: "App.tsx" },
		]);
	});

	it("serializes file mentions with Kilo file syntax", () => {
		const formatter = withFileMentions(createKiloSlashFormatter(new Map()));
		expect(formatter.serialize({ type: "file", id: "src/App.tsx", label: "App.tsx" })).toBe(
			"@/src/App.tsx",
		);
		expect(
			formatter.serialize({ type: "file", id: 'docs/weird"file.md', label: 'weird"file.md' }),
		).toBe('@"/docs/weird\\"file.md"');
	});

	it("resolves relative and absolute mentions across workspace folders", () => {
		const folders = [
			{ path: "/projects/app", isPrimary: true },
			{ path: "/projects/reference", isPrimary: false },
		];
		expect(resolveFileMention("src/App.tsx", folders)).toEqual({
			workspaceDirectory: "/projects/app",
			relativePath: "src/App.tsx",
		});
		expect(resolveFileMention("projects/reference/docs/Guide.md", folders)).toEqual({
			workspaceDirectory: "/projects/reference",
			relativePath: "docs/Guide.md",
		});
	});
});
