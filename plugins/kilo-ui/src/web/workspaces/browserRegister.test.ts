import { describe, expect, it, vi } from "vitest";

import { createFakeMainSdk } from "@anaconda-agentic-desktop/testing";

import type { Workspace, WorkspaceCapabilities } from "../../contracts/workspaces/schemas.js";
import { kiloUiBrowserRegister } from "../browserRegister.js";

describe("kiloUiBrowserRegister", () => {
	const CHAT_ID = "11111111-1111-4111-8111-111111111111";

	function boot() {
		const sdk = createFakeMainSdk({ featureId: "kilo-ui" });
		kiloUiBrowserRegister(sdk);
		return sdk;
	}

	it("supports CRUD, generated names, ordering, retained ids, and event snapshots", async () => {
		const sdk = boot();
		const createdEvent = vi.fn();
		const updatedEvent = vi.fn();
		const deletedEvent = vi.fn();
		sdk.events.on("kilo-ui.workspace-created", createdEvent);
		sdk.events.on("kilo-ui.workspace-updated", updatedEvent);
		sdk.events.on("kilo-ui.workspace-deleted", deletedEvent);

		const project = (await sdk.invoke("create", {
			folders: [{ path: "/projects/Project/", isPrimary: true }],
		})) as Workspace;
		expect(project.name).toBe("Project");
		expect(createdEvent).toHaveBeenCalledWith({ before: null, after: project });
		const capability = sdk.plugins.get<WorkspaceCapabilities>("kilo-ui")?.workspaceService;
		expect(capability).toBeDefined();
		await expect(capability!.get(project.id)).resolves.toEqual(project);

		const duplicate = (await sdk.invoke("create", {
			folders: [{ path: "C:\\projects\\Project", isPrimary: true }],
		})) as Workspace;
		expect(duplicate.name).toBe("Project (2)");
		const thirdProject = (await sdk.invoke("create", {
			folders: [{ path: "/another/Project", isPrimary: true }],
		})) as Workspace;
		expect(thirdProject.name).toBe("Project (3)");
		const fallbackName = (await sdk.invoke("create", {
			folders: [{ path: "/", isPrimary: true }],
		})) as Workspace;
		expect(fallbackName.name).toBe("Workspace");
		const explicit = (await sdk.invoke("create", {
			name: "  Alpha  ",
			folders: [{ path: "/projects/Alpha", isPrimary: true }],
		})) as Workspace;
		expect(explicit.name).toBe("Alpha");
		expect(((await sdk.invoke("list")) as Workspace[]).map((item) => item.name)).toEqual([
			"Alpha",
			"Project",
			"Project (2)",
			"Project (3)",
			"Workspace",
		]);

		const retainedFolderId = project.folders[0]!.id;
		const updated = (await sdk.invoke("update", {
			id: project.id,
			folders: [
				{ path: "/projects/Second", isPrimary: true },
				{ path: "/projects/Project/", isPrimary: false },
			],
		})) as Workspace;
		expect(updated.name).toBe("Project");
		expect(updated.folders[1]!.id).toBe(retainedFolderId);
		expect(updatedEvent).toHaveBeenCalledWith({ before: project, after: updated });

		const regenerated = await sdk.invoke("update", {
			id: project.id,
			name: " ",
			folders: updated.folders.map(({ path, isPrimary }) => ({ path, isPrimary })),
		});
		expect(regenerated).toMatchObject({ name: "Second" });
		await expect(sdk.invoke("get", { id: project.id })).resolves.toEqual(regenerated);

		await expect(capability!.remove(explicit.id)).resolves.toEqual({ deleted: true });
		expect(deletedEvent).toHaveBeenCalledWith({ before: explicit, after: null });
		sdk.dispose();
	});

	it("rejects invalid folder sets and missing mutations while reads return null", async () => {
		const sdk = boot();
		await expect(sdk.invoke("create", { folders: [] })).rejects.toMatchObject({
			code: "VALIDATION",
		});
		await expect(
			sdk.invoke("create", { folders: [{ path: "/project", isPrimary: false }] }),
		).rejects.toMatchObject({ code: "VALIDATION" });
		await expect(
			sdk.invoke("create", {
				folders: [
					{ path: "/same", isPrimary: true },
					{ path: "/same", isPrimary: false },
				],
			}),
		).rejects.toMatchObject({ code: "VALIDATION" });
		await expect(sdk.invoke("get", { id: "missing" })).resolves.toBeNull();
		await expect(sdk.invoke("remove", { id: "missing" })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		sdk.dispose();
	});

	it("reports that chat connections require the desktop app", async () => {
		const sdk = boot();
		await expect(sdk.invoke("chat.getConnection", { chatId: CHAT_ID })).rejects.toMatchObject({
			code: "BUSINESS",
			message: "Kilo Server requires the desktop app.",
		});
		sdk.dispose();
	});
});
