import { describe, expect, it } from "vitest";

import type { SessionMessageInfo } from "@kilo-desktop/react-opencode-v2";

import { kiloShellReport } from "../runtime/kilo-transcript";
import { normalizeBashOutput, parseBashResult } from "./tool-ui-shared";

describe("parseBashResult", () => {
	it("reads stdout/stderr/exitCode objects and JSON strings", () => {
		expect(parseBashResult({ stdout: "ok", stderr: "warn", exitCode: 2 })).toEqual({
			stdout: "ok",
			stderr: "warn",
			exitCode: 2,
		});
		expect(parseBashResult(JSON.stringify({ stdout: "ok", exitCode: 0 }))).toEqual({
			stdout: "ok",
			stderr: undefined,
			exitCode: 0,
		});
	});

	it("treats OpenCode output/exit fields as stdout/exitCode", () => {
		expect(parseBashResult({ output: "hello\n", exit: 0 })).toEqual({
			stdout: "hello\n",
			stderr: undefined,
			exitCode: 0,
		});
	});

	it("keeps plain text as stdout", () => {
		expect(parseBashResult("plain")).toEqual({ stdout: "plain" });
	});
});

describe("normalizeBashOutput", () => {
	it("strips ANSI color and normalizes carriage returns", () => {
		const colored = `${String.fromCharCode(0x1b)}[32mpassing${String.fromCharCode(0x1b)}[0m\r\nnext`;
		expect(normalizeBashOutput(colored)).toBe("passing\nnext");
	});
});

describe("kiloShellReport", () => {
	const step = (tools: unknown[]) =>
		({
			id: "msg_a",
			type: "assistant",
			agent: "code",
			model: { providerID: "kilo", id: "m" },
			time: { created: 1 },
			content: tools,
		}) as SessionMessageInfo;
	const shell = (id: string, metadata: Record<string, unknown>) => ({
		type: "tool",
		id,
		name: "shell",
		time: { created: 1 },
		state: { status: "running", input: { command: "ls" }, metadata },
	});

	it("reads a running shell call's output so far and a finished one's exit code", () => {
		const messages = [
			step([shell("call-1", { output: "chunk-one" }), shell("call-2", { exit: 2 })]),
		];
		expect(kiloShellReport(messages, "call-1")).toEqual({ output: "chunk-one" });
		expect(kiloShellReport(messages, "call-2")).toEqual({ exit: 2 });
		expect(kiloShellReport(messages, "missing")).toEqual({});
	});

	it("reads a composer shell run's output and exit", () => {
		const run = {
			id: "msg_s",
			type: "shell",
			shellID: "sh_1",
			command: "ls",
			status: "exited",
			exit: 1,
			output: { output: "a.txt", cursor: 5, size: 5, truncated: false },
			time: { created: 1, completed: 2 },
		} as SessionMessageInfo;
		expect(kiloShellReport([run], "sh_1")).toEqual({ output: "a.txt", exit: 1 });
	});
});
