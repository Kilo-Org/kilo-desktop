import { describe, expect, it, vi } from "vitest";

import type { GenerateInput } from "@kilo-desktop/plugin-core/contracts";

import { createSourceControlWriter, generationModel } from "./source-control-writer";

function setup(
	options: {
		answer?: Record<string, unknown>;
		commitMessage?: string;
		model?: GenerateInput["model"];
	} = {},
) {
	const generate = vi.fn(
		async (_input: GenerateInput) => options.answer ?? { message: " feat: add thing " },
	);
	const generateCommitMessage = vi.fn(
		async (_directory: string) => options.commitMessage ?? " feat: add thing ",
	);
	const writer = createSourceControlWriter({
		generate,
		generateCommitMessage,
		model: () =>
			"model" in options
				? options.model
				: { aiProviderId: "kilo", modelId: "fast", variant: "low" },
	});
	return { writer, generate, generateCommitMessage };
}

const commitInput = { directory: "/repo" };

const pullRequestInput = {
	directory: "/repo",
	baseBranch: "main",
	headBranch: "kilo/actions",
	commitSummary: "abc feat",
	diffSummary: "1 file changed",
	diffPatch: "+x",
	recentCommitSubjects: [],
	pullRequestTemplate: null,
};

describe("createSourceControlWriter", () => {
	it("asks Kilo's commit message generator for the repository's staged changes", async () => {
		const { writer, generate, generateCommitMessage } = setup();

		await expect(writer.generateCommitMessage(commitInput)).resolves.toBe("feat: add thing");

		expect(generateCommitMessage).toHaveBeenCalledWith("/repo");
		expect(generate).not.toHaveBeenCalled();
	});

	it("rejects an empty commit message", async () => {
		const { writer } = setup({ commitMessage: "  " });

		await expect(writer.generateCommitMessage(commitInput)).rejects.toThrow(
			"did not return a valid commit message",
		);
	});

	it("leaves the pull request model to the server when none is picked", async () => {
		const { writer, generate } = setup({ model: undefined, answer: { title: "Add", body: "" } });

		await writer.generatePullRequest(pullRequestInput);

		expect(generate.mock.calls[0]![0]).not.toHaveProperty("model");
		expect(generate.mock.calls[0]![0].prompt).toContain("None available");
	});

	it("generates pull request content that follows the repository template", async () => {
		const { writer, generate } = setup({ answer: { title: " Add actions ", body: "## Problem" } });

		await expect(
			writer.generatePullRequest({ ...pullRequestInput, pullRequestTemplate: "## Problem" }),
		).resolves.toEqual({ title: "Add actions", body: "## Problem" });

		const request = generate.mock.calls[0]![0];
		expect(request.title).toBe("Generate PR: kilo/actions");
		expect(request.system).toContain("preserve and fill the repository pull request template");
		expect(request.prompt).toContain("Repository pull request template:\n## Problem");
	});

	it("asks for Summary and Testing sections without a template", async () => {
		const { writer, generate } = setup({ answer: { title: "Add", body: "" } });

		await writer.generatePullRequest(pullRequestInput);

		expect(generate.mock.calls[0]![0].system).toContain("## Summary section");
	});

	it("rejects pull request content without a title", async () => {
		const { writer } = setup({ answer: { title: "", body: "x" } });

		await expect(writer.generatePullRequest(pullRequestInput)).rejects.toThrow(
			"did not return valid pull request content",
		);
	});
});

describe("generationModel", () => {
	const fast = { aiProviderId: "kilo", modelId: "fast" };
	const state = (preferred?: typeof fast & { variant: string }) => ({
		models: { "kilo/fast": { ...fast } },
		preferences: preferred ? { preferred } : {},
	});

	it("uses the preferred model the server offers, with its variant", () => {
		expect(generationModel(state({ ...fast, variant: "low" }))).toEqual({
			...fast,
			variant: "low",
		});
		expect(generationModel(state({ ...fast, variant: "" }))).toEqual(fast);
	});

	it("leaves the model to the server when the preferred one isn't offered, or none is", () => {
		expect(
			generationModel(state({ aiProviderId: "kilo", modelId: "gone", variant: "" })),
		).toBeUndefined();
		expect(generationModel(state())).toBeUndefined();
	});
});
