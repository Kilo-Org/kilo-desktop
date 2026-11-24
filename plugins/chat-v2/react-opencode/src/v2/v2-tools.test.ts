import type { SessionMessageAssistant } from "@kilocode/client";
import { describe, expect, it } from "vitest";

import { getOpenCodeTaskSessionId } from "../openCodeTaskSession";
import { toV1ContentParts } from "./v2-messages";
import { toV1PermissionRequest } from "./v2-events";
import { toV1PermissionName, toV1ToolInput, toV1ToolMetadata, toV1ToolName } from "./v2-tools";

type Content = SessionMessageAssistant["content"][number];

const completed = (
	name: string,
	input: Record<string, unknown>,
	metadata: Record<string, unknown>,
	text = "",
): Content =>
	({
		type: "tool",
		id: `call_${name}`,
		name,
		time: { created: 1, ran: 2, completed: 3 },
		state: { status: "completed", input, metadata, content: [{ type: "text", text }] },
	}) as unknown as Content;

describe("v2 tool names", () => {
	it("renames shell, subagent and patch, and keeps the others and MCP or Desktop tools", () => {
		expect(["shell", "subagent", "patch"].map(toV1ToolName)).toEqual([
			"bash",
			"task",
			"apply_patch",
		]);
		for (const name of [
			"read",
			"edit",
			"write",
			"glob",
			"grep",
			"webfetch",
			"websearch",
			"todowrite",
			"question",
			"skill",
			"desktop_x",
			"github_search",
		]) {
			expect(toV1ToolName(name)).toBe(name);
		}
		expect(toV1PermissionName("shell")).toBe("bash");
		expect(toV1PermissionName("external_directory")).toBe("external_directory");
	});

	it("names a skill and a subagent's agent as v1 did", () => {
		expect(toV1ToolInput("skill", { id: "tdd" })).toEqual({ id: "tdd", name: "tdd" });
		expect(toV1ToolInput("subagent", { agent: "explore", prompt: "p" })).toEqual({
			agent: "explore",
			prompt: "p",
			subagent_type: "explore",
		});
		expect(toV1ToolInput("read", { path: "a" })).toEqual({ path: "a" });
	});

	it("gives file tools v1's diff and a finished shell call its output", () => {
		const files = [
			{ file: "a.ts", patch: "--- a\n+++ a\n" },
			{ file: "b.ts", patch: "--- b\n+++ b\n" },
		];
		expect(toV1ToolMetadata("edit", { files })).toEqual({
			files,
			diff: "--- a\n+++ a\n\n--- b\n+++ b\n",
		});
		expect(toV1ToolMetadata("shell", { exit: 1, status: "completed" }, "boom")).toEqual({
			exit: 1,
			status: "completed",
			output: "boom",
		});
		expect(toV1ToolMetadata("shell", { output: "live" }, "final")).toEqual({ output: "live" });
	});
});

describe("v2 tool calls as kilo.chat's renderers read them", () => {
	it("shows a subagent call as a task whose child session opens", () => {
		const [part] = toV1ContentParts(
			"ses",
			"msg",
			[
				completed(
					"subagent",
					{ agent: "explore", description: "Look", prompt: "Find" },
					{ sessionID: "ses_child", status: "running" },
				),
			],
			0,
		);

		expect(part).toMatchObject({
			type: "tool",
			tool: "task",
			state: { input: { subagent_type: "explore" } },
		});
		expect(getOpenCodeTaskSessionId(part!)).toBe("ses_child");
	});

	it("shows shell as bash with its exit code and output, and patch as apply_patch with its diff", () => {
		const [shell, patch] = toV1ContentParts(
			"ses",
			"msg",
			[
				completed(
					"shell",
					{ command: "ls", description: "List" },
					{ exit: 2, status: "completed" },
					"a\nb",
				),
				completed(
					"patch",
					{ patchText: "*** Begin Patch" },
					{ files: [{ file: "a", patch: "diff" }] },
				),
			],
			0,
		);

		expect(shell).toMatchObject({
			tool: "bash",
			state: { input: { command: "ls" }, output: "a\nb", metadata: { exit: 2, output: "a\nb" } },
		});
		expect(patch).toMatchObject({
			tool: "apply_patch",
			state: { input: { patchText: "*** Begin Patch" }, metadata: { diff: "diff" } },
		});
	});

	it("asks permission for shell and subagent under v1's names, linked to their call", () => {
		expect(
			toV1PermissionRequest({
				id: "per",
				sessionID: "ses",
				action: "subagent",
				resources: ["explore"],
				save: ["explore"],
				source: { type: "tool", messageID: "msg", id: "call" },
			}),
		).toMatchObject({
			permission: "task",
			patterns: ["explore"],
			always: ["explore"],
			tool: { callID: "call" },
		});
	});
});
