import { describe, expect, it, vi } from "vitest";

import { ExternalEditorService } from "./ExternalEditorService.js";

describe("ExternalEditorService", () => {
	it("lists only editors with an available host command in product order", async () => {
		const resolveCommand = vi.fn(async (commands: readonly string[]) => {
			const command = commands.find((candidate) =>
				["cursor", "code", "zeditor"].includes(candidate),
			);
			return command ? `/usr/local/bin/${command}` : null;
		});
		const service = new ExternalEditorService({
			resolveCommand,
			launchDetached: vi.fn(),
		});

		await expect(service.listAvailable()).resolves.toEqual(["cursor", "vscode", "zed"]);
	});

	it("launches an editor detached with arguments kept separate from the file path", async () => {
		const launchDetached = vi.fn(async () => undefined);
		const service = new ExternalEditorService({
			resolveCommand: async () => "/Applications/Kiro.app/Contents/MacOS/kiro",
			launchDetached,
		});

		await service.open("kiro", "/workspace/project; echo unsafe.ts");

		expect(launchDetached).toHaveBeenCalledWith("/Applications/Kiro.app/Contents/MacOS/kiro", [
			"ide",
			"/workspace/project; echo unsafe.ts",
		]);
	});

	it("reports unavailable editors and launch failures as expected feature errors", async () => {
		const unavailable = new ExternalEditorService({
			resolveCommand: async () => null,
			launchDetached: vi.fn(),
		});
		await expect(unavailable.open("vscode", "/workspace/file.ts")).rejects.toMatchObject({
			code: "BUSINESS",
			message: "VS Code is not available.",
		});

		const failing = new ExternalEditorService({
			resolveCommand: async () => "/usr/local/bin/code",
			launchDetached: async () => {
				throw new Error("spawn failed");
			},
		});
		await expect(failing.open("vscode", "/workspace/file.ts")).rejects.toMatchObject({
			code: "BUSINESS",
			message: "Could not open the file in VS Code.",
		});
	});

	it("rejects an editor id that bypasses contract validation", async () => {
		const service = new ExternalEditorService({
			resolveCommand: vi.fn(),
			launchDetached: vi.fn(),
		});

		await expect(service.open("unknown" as never, "/workspace/file.ts")).rejects.toMatchObject({
			code: "VALIDATION",
			message: "Unknown external editor.",
		});
	});
});
