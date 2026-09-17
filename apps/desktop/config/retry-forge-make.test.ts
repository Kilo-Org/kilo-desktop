import { describe, expect, it, vi } from "vitest";

import {
	isHdiutilDetachEnoent,
	runForgeMakeWithDetachRetry,
	type ExecutionOutcome,
	type ForgeInvocation,
} from "./retry-forge-make.js";

const invocation: ForgeInvocation = { command: "electron-forge", args: ["make"] };

function success(): ExecutionOutcome {
	return { exitCode: 0, stdout: "", stderr: "", failed: false };
}

function detachEnoent(stream: "stderr" | "stdout" = "stderr"): ExecutionOutcome {
	const message =
		"✖ Making a dmg distributable for darwin/arm64 [FAILED: Command failed: " +
		"hdiutil detach /Volumes/Agentic Preview\nhdiutil: detach failed - No such file or directory\n";
	return {
		exitCode: 1,
		stdout: stream === "stdout" ? message : "",
		stderr: stream === "stderr" ? message : "",
		failed: true,
	};
}

function otherFailure(): ExecutionOutcome {
	return {
		exitCode: 1,
		stdout: "",
		stderr: "Error: something totally unrelated exploded",
		failed: true,
	};
}

describe("isHdiutilDetachEnoent", () => {
	it("matches the appdmg failure signature on either stream", () => {
		expect(isHdiutilDetachEnoent(detachEnoent("stderr"))).toBe(true);
		expect(isHdiutilDetachEnoent(detachEnoent("stdout"))).toBe(true);
	});

	it("does not match unrelated failures", () => {
		expect(isHdiutilDetachEnoent(otherFailure())).toBe(false);
	});

	it("does not match successful runs even if the text appears in logs", () => {
		const outcome: ExecutionOutcome = {
			exitCode: 0,
			stdout:
				"hdiutil: detach failed - No such file or directory (from a prior run, informational)",
			stderr: "",
			failed: false,
		};
		expect(isHdiutilDetachEnoent(outcome)).toBe(false);
	});
});

describe("runForgeMakeWithDetachRetry", () => {
	it("returns the successful outcome on the first attempt without touching hdiutil", async () => {
		const runForge = vi.fn().mockResolvedValue(success());
		const forceDetach = vi.fn().mockResolvedValue(undefined);
		const sleep = vi.fn().mockResolvedValue(undefined);

		const outcome = await runForgeMakeWithDetachRetry(invocation, {
			volumeTitles: ["Agentic Preview"],
			runForge,
			forceDetach,
			sleep,
		});

		expect(outcome.failed).toBe(false);
		expect(runForge).toHaveBeenCalledTimes(1);
		expect(forceDetach).not.toHaveBeenCalled();
		expect(sleep).not.toHaveBeenCalled();
	});

	it("force-detaches every configured volume and retries after the detach-ENOENT flake", async () => {
		const runForge = vi.fn().mockResolvedValueOnce(detachEnoent()).mockResolvedValueOnce(success());
		const forceDetach = vi.fn().mockResolvedValue(undefined);
		const sleep = vi.fn().mockResolvedValue(undefined);

		const outcome = await runForgeMakeWithDetachRetry(invocation, {
			volumeTitles: ["Agentic Preview", "Agentic"],
			runForge,
			forceDetach,
			sleep,
			retryDelayMs: 42,
		});

		expect(outcome.failed).toBe(false);
		expect(runForge).toHaveBeenCalledTimes(2);
		expect(forceDetach.mock.calls.map((call) => call[0])).toEqual([
			"/Volumes/Agentic Preview",
			"/Volumes/Agentic",
		]);
		expect(sleep).toHaveBeenCalledWith(42);
	});

	it("stops after maxAttempts even if every attempt is the flake", async () => {
		const runForge = vi.fn().mockResolvedValue(detachEnoent());
		const forceDetach = vi.fn().mockResolvedValue(undefined);
		const sleep = vi.fn().mockResolvedValue(undefined);

		const outcome = await runForgeMakeWithDetachRetry(invocation, {
			volumeTitles: ["Agentic Preview"],
			maxAttempts: 2,
			runForge,
			forceDetach,
			sleep,
		});

		expect(outcome.failed).toBe(true);
		expect(runForge).toHaveBeenCalledTimes(2);
		// Only detach *between* attempts, never after the final failure.
		expect(forceDetach).toHaveBeenCalledTimes(1);
	});

	it("does not retry unrelated failures", async () => {
		const runForge = vi.fn().mockResolvedValue(otherFailure());
		const forceDetach = vi.fn().mockResolvedValue(undefined);

		const outcome = await runForgeMakeWithDetachRetry(invocation, {
			volumeTitles: ["Agentic Preview"],
			runForge,
			forceDetach,
			sleep: vi.fn().mockResolvedValue(undefined),
		});

		expect(outcome.failed).toBe(true);
		expect(runForge).toHaveBeenCalledTimes(1);
		expect(forceDetach).not.toHaveBeenCalled();
	});

	it("swallows force-detach failures so a throwing hdiutil cannot abort the retry", async () => {
		const runForge = vi.fn().mockResolvedValueOnce(detachEnoent()).mockResolvedValueOnce(success());
		const forceDetach = vi.fn().mockRejectedValue(new Error("boom"));
		const sleep = vi.fn().mockResolvedValue(undefined);

		const outcome = await runForgeMakeWithDetachRetry(invocation, {
			volumeTitles: ["Agentic Preview", "Agentic"],
			runForge,
			forceDetach,
			sleep,
		});

		expect(outcome.failed).toBe(false);
		// Both titles must still be attempted even though the first throws.
		expect(forceDetach.mock.calls.map((call) => call[0])).toEqual([
			"/Volumes/Agentic Preview",
			"/Volumes/Agentic",
		]);
		expect(runForge).toHaveBeenCalledTimes(2);
	});
});
