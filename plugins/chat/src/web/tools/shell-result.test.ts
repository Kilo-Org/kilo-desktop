import { describe, expect, it } from "vitest";

import type { SessionMessageAssistantTool } from "@kilo-desktop/react-opencode";

import { tool } from "../../test/kilo2/fixtures";
import { readShellResult } from "./shell-result";
import { normalizeBashOutput } from "./tool-ui-shared";

const shell = (patch: Partial<SessionMessageAssistantTool>) =>
	tool("shell", { command: "ls" }, "", patch);

const completed = (texts: string[], metadata: Record<string, unknown>) =>
	shell({
		state: {
			status: "completed",
			input: { command: "ls" },
			content: texts.map((text) => ({ type: "text" as const, text })) as never,
			metadata: metadata as never,
		},
	});

describe("readShellResult", () => {
	it("reads a successful command's output", () => {
		expect(readShellResult(completed(["a\nb\n"], { status: "completed", exit: 0 }), "")).toEqual({
			output: "a\nb\n",
			notice: undefined,
			exitCode: 0,
			failed: false,
			background: false,
		});
	});

	it("splits a failed command's exit notice from its output", () => {
		expect(
			readShellResult(
				completed(["boom", "Exit code: 2"], { status: "completed", exit: 2 }),
				"boom\nExit code: 2",
			),
		).toMatchObject({ output: "boom", notice: "Exit code: 2", exitCode: 2, failed: true });
		expect(
			readShellResult(completed(["Command timed out"], { status: "completed", timeout: true }), ""),
		).toMatchObject({ output: "", notice: "Command timed out", failed: true });
	});

	it("marks a backgrounded command, whose notice is the model's instruction", () => {
		expect(
			readShellResult(
				completed(["Command moved to the background", "You will be notified"], {
					status: "running",
				}),
				"",
			),
		).toMatchObject({
			output: "Command moved to the background",
			notice: "You will be notified",
			failed: false,
			background: true,
		});
	});

	it("reads a running command's live progress output", () => {
		const running = shell({
			state: {
				status: "running",
				input: { command: "ls" },
				metadata: { shellID: "sh_1", output: "partial", status: "running" } as never,
			},
		});
		expect(readShellResult(running, undefined)).toMatchObject({ output: "partial" });
	});

	it("separates an interrupted command's output from its notice", () => {
		const notice = "Command interrupted by the user (shell ID: sh_1).";
		const interrupted = shell({
			state: {
				status: "error",
				input: { command: "ls" },
				error: { type: "interrupted", message: `partial\n\n${notice}` },
				metadata: { interrupted: true, notice } as never,
			},
		});
		expect(readShellResult(interrupted, undefined)).toMatchObject({
			output: "partial",
			notice,
			failed: false,
		});
	});

	it("falls back to the part's result text without the v2 tool call", () => {
		expect(readShellResult(undefined, "plain")).toMatchObject({ output: "plain", failed: false });
	});
});

describe("normalizeBashOutput", () => {
	it("strips ANSI color and normalizes carriage returns", () => {
		const colored = `${String.fromCharCode(0x1b)}[32mpassing${String.fromCharCode(0x1b)}[0m\r\nnext`;
		expect(normalizeBashOutput(colored)).toBe("passing\nnext");
	});
});
