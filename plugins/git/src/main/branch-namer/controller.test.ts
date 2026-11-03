import { describe, expect, it, vi } from "vitest";

import {
	createBranchNamer,
	type ArmedChats,
	type BranchNamerDeps,
	type NamerTarget,
} from "./controller.js";

const DIRECTORY = "/repo/.kilo/worktrees/kilo-aback-aardvark";
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

function setup(
	options: {
		generatedBranch?: string | null;
		renamedBranch?: { branch: string } | null;
		armed?: boolean;
		baseRef?: string;
		hasWorktreeWork?: BranchNamerDeps["hasWorktreeWork"];
		saved?: ArmedChats;
	} = {},
) {
	let busy = false;
	let eligible: NamerTarget | null = {
		sessionId: "wses_1",
		directory: DIRECTORY,
		currentBranch: "kilo/aback-aardvark",
	};
	let gitBranch = "kilo/aback-aardvark";
	let saved: ArmedChats = options.saved ?? {};
	const generate = vi.fn<BranchNamerDeps["generate"]>(async () =>
		options.generatedBranch === undefined ? "fix-the-login-bug" : options.generatedBranch,
	);
	// Mirrors git's guard: declines unless `currentBranch` is still the branch.
	const rename = vi.fn<BranchNamerDeps["rename"]>(async (input) => {
		if (options.renamedBranch !== undefined) return options.renamedBranch;
		if (input.currentBranch !== gitBranch) return null;
		gitBranch = `kilo/${input.requestedBranch}`;
		if (eligible) eligible = { ...eligible, currentBranch: gitBranch };
		return { branch: gitBranch };
	});
	const renamed = vi.fn<BranchNamerDeps["renamed"]>(async () => {});
	const hasWorktreeWork = vi.fn<BranchNamerDeps["hasWorktreeWork"]>(
		options.hasWorktreeWork ?? (async () => true),
	);
	const deps: BranchNamerDeps = {
		target: () => eligible,
		isBusy: () => busy,
		generate,
		rename,
		hasWorktreeWork,
		renamed,
		progress: { load: () => saved, save: (armed) => (saved = armed) },
	};
	let namer = createBranchNamer(deps);
	if (options.armed !== false) {
		namer.arm("ses_1", options.baseRef ? { baseRef: options.baseRef } : undefined);
	}
	const prompt = (text: string, model?: { providerID: string; modelID: string }) =>
		namer.prompt({ chatId: "ses_1", text, model });
	const setBusy = () => {
		busy = true;
	};
	const setIdle = () => {
		busy = false;
		namer.turnEnded("ses_1");
	};
	const turn = async (text: string) => {
		prompt(text);
		setBusy();
		await settle();
		setIdle();
		await settle();
	};
	const successfulRenames = () =>
		rename.mock.settledResults.filter(
			(result) => result.type === "fulfilled" && result.value !== null,
		).length;
	return {
		get namer() {
			return namer;
		},
		generate,
		rename,
		renamed,
		hasWorktreeWork,
		prompt,
		setBusy,
		setIdle,
		turn,
		successfulRenames,
		saved: () => saved,
		ineligible: () => (eligible = null),
		gitBranch: () => gitBranch,
		restart: () => {
			namer.dispose();
			namer = createBranchNamer(deps);
		},
	};
}

describe("createBranchNamer", () => {
	it("counts the first prompt and dispatches a generation on the second", async () => {
		const s = setup();

		s.prompt("hello");
		expect(s.generate).not.toHaveBeenCalled();

		s.prompt("fix the login bug");
		await vi.waitFor(() =>
			expect(s.generate).toHaveBeenCalledWith({ chatId: "ses_1", prompt: "fix the login bug" }),
		);
	});

	it("renames the branch and records it on the session and chat", async () => {
		const s = setup();

		s.prompt("hello");
		s.prompt("fix the login bug");

		await vi.waitFor(() =>
			expect(s.renamed).toHaveBeenCalledWith({
				chatId: "ses_1",
				sessionId: "wses_1",
				branch: "kilo/fix-the-login-bug",
			}),
		);
		expect(s.rename).toHaveBeenCalledWith({
			directory: DIRECTORY,
			currentBranch: "kilo/aback-aardvark",
			requestedBranch: "fix-the-login-bug",
		});
		expect(s.saved()).toEqual({});
	});

	it("keeps the chat armed when the server declines with null", async () => {
		const s = setup({ generatedBranch: null });

		s.prompt("hello");
		s.prompt("hi there");
		await vi.waitFor(() => expect(s.generate).toHaveBeenCalledTimes(1));
		await settle();
		expect(s.rename).not.toHaveBeenCalled();

		s.prompt("fix the login bug");
		await vi.waitFor(() => expect(s.generate).toHaveBeenCalledTimes(2));
	});

	it("stays armed when git declines the rename", async () => {
		const s = setup({ renamedBranch: null });

		s.prompt("hello");
		s.prompt("fix the login bug");
		await vi.waitFor(() => expect(s.rename).toHaveBeenCalledTimes(1));
		await settle();
		expect(s.renamed).not.toHaveBeenCalled();

		s.prompt("more detail");
		await vi.waitFor(() => expect(s.generate).toHaveBeenCalledTimes(2));
	});

	it("holds a name generated while busy until the turn ends", async () => {
		const s = setup();

		s.setBusy();
		s.prompt("hello");
		s.prompt("fix the login bug");
		await vi.waitFor(() => expect(s.generate).toHaveBeenCalledTimes(1));
		await settle();
		expect(s.rename).not.toHaveBeenCalled();

		s.setIdle();
		await vi.waitFor(() => expect(s.renamed).toHaveBeenCalledTimes(1));
	});

	it("dispatches once when the turn of a single prompt ends", async () => {
		const s = setup();

		s.prompt("one very detailed prompt");
		s.setBusy();
		s.setIdle();
		await vi.waitFor(() =>
			expect(s.generate).toHaveBeenCalledWith({ chatId: "ses_1", prompt: "" }),
		);

		s.setIdle();
		s.setIdle();
		await settle();
		expect(s.generate).toHaveBeenCalledTimes(1);
	});

	it("skips the idle path while the worktree has no work, retrying on the next turn end", async () => {
		const s = setup({ hasWorktreeWork: async () => false });

		s.prompt("hello");
		s.setBusy();
		s.setIdle();
		await vi.waitFor(() => expect(s.hasWorktreeWork).toHaveBeenCalledTimes(1));
		await settle();
		expect(s.generate).not.toHaveBeenCalled();
		expect(s.saved().ses_1).toMatchObject({ promptCount: 1, idleAttempted: false });

		s.hasWorktreeWork.mockResolvedValue(true);
		s.setIdle();
		await vi.waitFor(() => expect(s.generate).toHaveBeenCalledTimes(1));
	});

	it("treats a failing work probe as no work", async () => {
		const s = setup({ hasWorktreeWork: async () => Promise.reject(new Error("git failed")) });

		await s.turn("hello");

		expect(s.generate).not.toHaveBeenCalled();
	});

	it("disarms when the chat is no longer eligible", async () => {
		const s = setup();
		s.ineligible();

		s.prompt("hello");
		s.prompt("fix the login bug");
		s.setIdle();
		await settle();

		expect(s.generate).not.toHaveBeenCalled();
		expect(s.saved()).toEqual({});
	});

	it("drops a name when the chat lost eligibility while it was generated", async () => {
		const s = setup();
		s.setBusy();
		s.prompt("hello");
		s.prompt("fix the login bug");
		await vi.waitFor(() => expect(s.generate).toHaveBeenCalledTimes(1));

		s.ineligible();
		s.setIdle();
		await settle();

		expect(s.rename).not.toHaveBeenCalled();
		expect(s.saved()).toEqual({});
	});

	it("disarms when the single-prompt chat is no longer eligible as its turn ends", async () => {
		const s = setup();
		s.prompt("hello");
		s.ineligible();

		s.setIdle();
		await settle();

		expect(s.hasWorktreeWork).not.toHaveBeenCalled();
		expect(s.saved()).toEqual({});
	});

	it("disarms after the prompt cap", async () => {
		const s = setup({ generatedBranch: null });

		s.prompt("prompt 1");
		s.prompt("prompt 2");
		await vi.waitFor(() => expect(s.generate).toHaveBeenCalledTimes(1));
		await settle();
		s.prompt("prompt 3");
		await vi.waitFor(() => expect(s.generate).toHaveBeenCalledTimes(2));
		await settle();
		s.prompt("prompt 4");
		await vi.waitFor(() => expect(s.generate).toHaveBeenCalledTimes(3));

		s.prompt("prompt 5");
		await settle();
		expect(s.generate).toHaveBeenCalledTimes(3);
		expect(s.saved()).toEqual({});
	});

	it("never names a chat that was not armed", async () => {
		const s = setup({ armed: false });

		for (let index = 1; index <= 3; index++) await s.turn(`prompt ${index}`);

		expect(s.generate).not.toHaveBeenCalled();
	});

	it("renames at most once, even across many turns with work", async () => {
		const s = setup();
		let generated = 0;
		s.generate.mockImplementation(async () => `name-${++generated}`);

		for (let index = 1; index <= 8; index++) await s.turn(`prompt ${index}`);

		expect(s.successfulRenames()).toBe(1);
		expect(s.gitBranch()).toBe("kilo/name-1");
	});

	it("stays disarmed after the prompt cap", async () => {
		const s = setup({ generatedBranch: null, hasWorktreeWork: async () => false });

		for (let index = 1; index <= 9; index++) await s.turn(`prompt ${index}`);

		expect(s.generate).toHaveBeenCalledTimes(3);
	});

	it("passes the base ref to the work probe, or nothing when cut from HEAD", async () => {
		const withBase = setup({ baseRef: "origin/main" });
		await withBase.turn("one detailed prompt");
		expect(withBase.hasWorktreeWork).toHaveBeenCalledWith({
			directory: DIRECTORY,
			baseBranch: "origin/main",
		});

		const fromHead = setup();
		await fromHead.turn("one detailed prompt");
		expect(fromHead.hasWorktreeWork).toHaveBeenCalledWith({ directory: DIRECTORY });
	});

	it("runs the single-prompt idle path only when a turn ends", async () => {
		const s = setup();

		s.prompt("one detailed prompt");
		await settle();
		expect(s.hasWorktreeWork).not.toHaveBeenCalled();

		s.setBusy();
		s.namer.turnEnded("ses_1");
		await settle();
		expect(s.hasWorktreeWork).not.toHaveBeenCalled();

		s.setIdle();
		await vi.waitFor(() => expect(s.generate).toHaveBeenCalledTimes(1));
	});

	it("does not dispatch a second generation while the work probe is in flight", async () => {
		let resolveWork!: (hasWork: boolean) => void;
		const s = setup({
			hasWorktreeWork: () => new Promise<boolean>((resolve) => (resolveWork = resolve)),
		});

		s.prompt("detailed first prompt");
		s.setBusy();
		s.setIdle();
		s.prompt("second prompt");
		resolveWork(true);

		await vi.waitFor(() => expect(s.successfulRenames()).toBe(1));
		await settle();
		expect(s.generate).toHaveBeenCalledTimes(1);
	});

	it("forwards the prompt's model, including on the idle path", async () => {
		const s = setup({ generatedBranch: null });
		const model = { providerID: "kilo", modelID: "anthropic/claude" };

		s.prompt("hello", model);
		s.setBusy();
		s.setIdle();
		await vi.waitFor(() =>
			expect(s.generate).toHaveBeenCalledWith({ chatId: "ses_1", prompt: "", model }),
		);

		s.prompt("fix the login bug", model);
		await vi.waitFor(() =>
			expect(s.generate).toHaveBeenLastCalledWith({
				chatId: "ses_1",
				prompt: "fix the login bug",
				model,
			}),
		);
	});

	it("disarms once git renamed the branch, even when recording it fails", async () => {
		const s = setup();
		s.renamed.mockRejectedValue(new Error("server unavailable"));

		for (let index = 1; index <= 5; index++) await s.turn(`prompt ${index}`);

		expect(s.successfulRenames()).toBe(1);
		expect(s.saved()).toEqual({});
	});

	it("survives a failing generation, staying armed", async () => {
		const s = setup();
		s.generate.mockRejectedValueOnce(new Error("server down"));

		s.prompt("hello");
		s.prompt("fix the login bug");
		await vi.waitFor(() => expect(s.generate).toHaveBeenCalledTimes(1));
		await settle();
		s.prompt("fix it now");

		await vi.waitFor(() => expect(s.renamed).toHaveBeenCalledTimes(1));
	});

	it("keeps progress across a restart without renaming twice", async () => {
		const s = setup({ generatedBranch: null });
		s.prompt("hello");
		expect(s.saved()).toEqual({ ses_1: { promptCount: 1, idleAttempted: false } });

		s.restart();
		s.generate.mockResolvedValue("fix-the-login-bug");
		s.prompt("fix the login bug");
		await vi.waitFor(() => expect(s.successfulRenames()).toBe(1));
		expect(s.generate).toHaveBeenCalledWith({ chatId: "ses_1", prompt: "fix the login bug" });

		s.restart();
		for (let index = 1; index <= 3; index++) await s.turn(`prompt ${index}`);
		expect(s.successfulRenames()).toBe(1);
	});

	it("forgets a chat for good", async () => {
		const s = setup();

		s.namer.forget("ses_1");
		s.prompt("hello");
		s.prompt("fix the login bug");
		await settle();

		expect(s.generate).not.toHaveBeenCalled();
		expect(s.saved()).toEqual({});
	});

	it("dispose aborts in-flight generations and ignores later calls", async () => {
		const s = setup();

		s.prompt("hello");
		s.prompt("fix the login bug");
		s.namer.dispose();
		s.namer.arm("ses_2");
		s.prompt("more");
		s.setIdle();
		await settle();

		expect(s.rename).not.toHaveBeenCalled();
		expect(s.saved()).toEqual({ ses_1: { promptCount: 2, idleAttempted: false } });
	});
});
