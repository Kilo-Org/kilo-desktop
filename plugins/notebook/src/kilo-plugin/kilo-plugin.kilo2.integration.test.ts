import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { OpenCode } from "@kilocode/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
	installKiloPlugin,
	kilo2Executable,
	STAND_IN_MODEL,
	standInProviderConfig,
	startKilo2,
	startStandInModel,
	type Kilo2,
	type StandInModel,
	type StandInRequest,
} from "@kilo-desktop/plugin-core/testing";

import { buildKiloPlugin } from "../../scripts/kilo-plugin-build";

const NOTEBOOK_ID = "669d39ec-39d6-4160-815c-b46e170cde8d";

/**
 * A stand-in for `@runtimed/node` (loaded through NTERACT_RUNTIMED_NODE_PATH,
 * as Desktop points Kilo at the bundled one): one open notebook in the
 * project with one code cell, whose runs it records in `runs.log`.
 */
function fakeRuntimed(notebookPath: string, runsLog: string): string {
	return `const { appendFileSync } = require("node:fs");
const cells = [{ id: "cell-1", cellType: "code", position: "a0", source: "40 + 2", metadataJson: "{}" }];
const done = (cellId) => ({ cellId, executionId: "exec-" + cellId, executionCount: 1, status: "done", success: true,
  outputs: [{ outputType: "stream", name: "stdout", text: "42\\n" }] });
module.exports = {
  listActiveNotebooks: async () => [{ notebookId: ${JSON.stringify(NOTEBOOK_ID)}, notebookPath: ${JSON.stringify(notebookPath)} }],
  getExecutionResult: async () => null,
  openNotebook: async (notebookId) => ({
    notebookId,
    listCells: async () => cells,
    getCell: async (id) => cells.find((cell) => cell.id === id) ?? null,
    getExecutionView: () => ({ cell_execution_ids: {}, executions: {}, queue: null }),
    runCell: async (code) => { appendFileSync(${JSON.stringify(runsLog)}, code + "\\n"); return done("cell-2"); },
    close: async () => {},
  }),
};
`;
}

/** Each turn calls one notebook tool, then answers once its result is in. */
function notebookTurn(tool: string, args: Record<string, unknown>) {
	return (request: StandInRequest) => {
		if (!request.tools?.length) return { text: ["Title"] };
		if (request.messages.some((message) => message.role === "tool")) return { text: ["Done."] };
		return { toolCalls: [{ id: `call_${tool}`, name: tool, arguments: args }] };
	};
}

/**
 * kilo.notebook's Kilo server plugin on the bundled kilo2: Desktop builds and
 * installs it as it ships, Kilo loads it, the model sees the notebook tools
 * by name, a tool runs against runtimed, and running code asks the person
 * first although Kilo's agent allows every action.
 */
describe.skipIf(!kilo2Executable)("kilo.notebook's Kilo plugin on kilo2", () => {
	let work: string;
	let model: StandInModel;
	let kilo: Kilo2;
	let client: ReturnType<typeof OpenCode.make>;
	let project: string;
	let runsLog: string;
	let reply: (request: StandInRequest) => ReturnType<ReturnType<typeof notebookTurn>>;

	beforeAll(async () => {
		work = await realpath(await mkdtemp(path.join(tmpdir(), "notebook-kilo-plugin-")));
		const bundle = await buildKiloPlugin(path.join(work, "bundle"));
		project = path.join(work, "project");
		await mkdir(project);
		runsLog = path.join(work, "runs.log");
		const runtimed = path.join(work, "runtimed.cjs");
		await writeFile(runtimed, fakeRuntimed(path.join(project, "analysis.ipynb"), runsLog));
		reply = () => ({ text: ["Hello."] });
		model = await startStandInModel((request) => reply(request));
		kilo = await startKilo2({
			environment: { NTERACT_RUNTIMED_NODE_PATH: runtimed },
			before: async (home) => {
				await writeFile(
					path.join(home, "runtime", "config", "kilo2", "kilo2.jsonc"),
					JSON.stringify(standInProviderConfig(model.baseURL)),
				);
				await installKiloPlugin(home, "kilo.notebook", "kilo-plugin", bundle);
			},
		});
		client = OpenCode.make({
			baseUrl: kilo.connection.baseUrl,
			headers: {
				authorization: `Basic ${btoa(`${kilo.connection.username}:${kilo.connection.password}`)}`,
			},
		});
		const location = { directory: project };
		await vi.waitFor(
			async () =>
				expect((await client.plugin.list({ location })).data).toContainEqual(
					expect.objectContaining({ id: "anaconda-notebooks", state: { status: "active" } }),
				),
			{ timeout: 20_000 },
		);
	});

	afterAll(async () => {
		await kilo?.stop();
		await model?.stop();
		if (work) await rm(work, { recursive: true, force: true });
	});

	async function turn(tool: string, args: Record<string, unknown>) {
		reply = notebookTurn(tool, args);
		const session = await client.session.create({
			location: { directory: project },
			model: STAND_IN_MODEL,
		});
		await client.session.prompt({ sessionID: session.id, text: `Use ${tool}` });
		return session;
	}

	async function toolOutput(sessionID: string) {
		let text = "";
		await vi.waitFor(
			async () => {
				const { data } = await client.message.list({ sessionID, order: "asc" });
				const result = JSON.stringify(data);
				expect(result).toMatch(/"status":"(completed|error)"/);
				expect(result).not.toMatch(/"status":"error"/);
				text = result;
			},
			{ timeout: 20_000 },
		);
		return text;
	}

	it("offers the notebook tools by name and reads a notebook", async () => {
		const session = await turn("notebooks_read", { notebook_id: NOTEBOOK_ID });

		const output = await toolOutput(session.id);
		const offered = model.requests.find((request) => request.tools?.length)!;
		expect(offered.tools!.map((tool) => tool.function?.name)).toEqual(
			expect.arrayContaining([
				"notebooks_read",
				"notebooks_run_cell",
				"notebooks_execute",
				"notebooks_dependencies",
				"notebooks_save",
			]),
		);
		expect(output).toContain("40 + 2");
	});

	it("asks before running notebook code, then runs it once allowed", async () => {
		const asked: { id: string; sessionID: string; action: string }[] = [];
		const stream = new AbortController();
		void (async () => {
			for await (const event of client.event.subscribe({
				types: ["permission.asked"],
				signal: stream.signal,
			})) {
				if (event.type === "permission.asked") asked.push(event.data);
			}
		})().catch(() => undefined);
		try {
			const session = await turn("notebooks_run_cell", {
				notebook_id: NOTEBOOK_ID,
				code: "print('hi')",
			});

			await vi.waitFor(() => expect(asked).toHaveLength(1), { timeout: 20_000 });
			expect(asked[0]).toMatchObject({ action: "notebooks_execute" });
			await expect(access(runsLog)).rejects.toThrow();
			await client.permission.reply({
				sessionID: asked[0]!.sessionID,
				requestID: asked[0]!.id,
				decision: "once",
			});

			expect(await toolOutput(session.id)).toContain("42");
			await expect(readFile(runsLog, "utf8")).resolves.toBe("print('hi')\n");
		} finally {
			stream.abort();
		}
	});
});
