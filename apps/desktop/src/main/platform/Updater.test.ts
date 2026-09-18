import { EventEmitter } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";

import type {
	DesktopReleaseNotes,
	DesktopUpdateState,
	ReleaseTrack,
} from "@kilo-desktop/contracts";

import { DesktopUpdaterService } from "./Updater.js";

class FakeNativeUpdater extends EventEmitter {
	readonly setFeedURL = vi.fn();
	readonly checkForUpdates = vi.fn();
	readonly quitAndInstall = vi.fn();
}

const notes = {
	schemaVersion: 1 as const,
	track: "preview" as const,
	version: "1.2.3-preview-260826-12000",
	title: "Preview update",
	publishedAt: "2026-08-26T12:00:00.000Z",
	bodyMarkdown: "* Faster startup",
	items: ["Faster startup"],
};

function createService(
	overrides: {
		isPackaged?: boolean;
		platform?: NodeJS.Platform;
		publishUrl?: string;
		fetch?: typeof fetch;
		updater?: FakeNativeUpdater;
		installWithShutdown?: (install: () => void) => void;
		track?: ReleaseTrack;
		currentVersion?: string;
	} = {},
) {
	const updater = overrides.updater ?? new FakeNativeUpdater();
	const states: DesktopUpdateState[] = [];
	const service = new DesktopUpdaterService({
		isPackaged: overrides.isPackaged ?? true,
		platform: overrides.platform ?? "darwin",
		arch: "arm64",
		track: overrides.track ?? "preview",
		currentVersion: overrides.currentVersion ?? "1.2.2",
		publishUrl: overrides.publishUrl ?? "https://updates.example.com",
		installWithShutdown: overrides.installWithShutdown ?? ((install) => install()),
		fetch:
			overrides.fetch ??
			((async () => new Response(JSON.stringify(notes), { status: 200 })) as typeof fetch),
		broadcast: (state) => states.push(state),
		logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
		updater: updater as never,
	});
	return { service, updater, states };
}

afterEach(() => {
	vi.useRealTimers();
});

describe("DesktopUpdaterService", () => {
	it("configures the native feed and reaches downloaded state with S3 notes", async () => {
		vi.useFakeTimers();
		const { service, updater, states } = createService();
		service.start();
		expect(updater.setFeedURL).toHaveBeenCalledWith({
			url: "https://updates.example.com/kilo-desktop/preview/darwin/arm64/RELEASES.json",
			serverType: "json",
		});

		expect((await service.check()).accepted).toBe(true);
		updater.emit("update-available");
		expect(service.state.status).toBe("downloading");
		updater.emit("update-downloaded", {}, "", notes.version, new Date(), "");
		await vi.waitFor(() => expect(service.state.status).toBe("downloaded"));
		expect(service.state.releaseNotes[0]?.items).toEqual(["Faster startup"]);
		expect(states.at(-1)?.downloadedVersion).toBe(notes.version);
		service.dispose();
	});

	it("keeps release-note failures outside the update path", async () => {
		vi.useFakeTimers();
		const { service, updater } = createService({
			fetch: (async () => new Response("unavailable", { status: 503 })) as typeof fetch,
		});
		service.start();
		expect((await service.check()).accepted).toBe(true);
		updater.emit("update-downloaded", {}, "", "1.2.3", new Date(), "");
		await vi.waitFor(() => expect(service.state.status).toBe("downloaded"));
		expect(service.state.releaseNotes).toEqual([]);
		service.dispose();
	});

	it("combines skipped Preview release notes back to the installed version", async () => {
		vi.useFakeTimers();
		const target: DesktopReleaseNotes = {
			...notes,
			version: "1.2.5-preview-260826-15000",
			previousVersion: "1.2.4-preview-260826-14000",
			items: ["Newest change"],
		};
		const skipped: DesktopReleaseNotes = {
			...notes,
			version: target.previousVersion!,
			previousVersion: "1.2.3-preview-260826-13000",
			items: ["Skipped change"],
		};
		const fetchNotes = vi.fn(async (input: string | URL | Request) => {
			const url = String(input);
			return new Response(JSON.stringify(url.endsWith("latest.json") ? target : skipped), {
				status: 200,
			});
		});
		const { service, updater } = createService({
			currentVersion: skipped.previousVersion!,
			fetch: fetchNotes as typeof fetch,
		});
		service.start();
		await service.check();
		updater.emit("update-downloaded", {}, "", target.version, new Date(), "");

		await vi.waitFor(() => expect(service.state.status).toBe("downloaded"));
		expect(service.state.releaseNotes.map((release) => release.version)).toEqual([
			target.version,
			skipped.version,
		]);
		expect(fetchNotes).toHaveBeenCalledTimes(2);
		service.dispose();
	});

	it("keeps Stable release notes limited to the target release", async () => {
		vi.useFakeTimers();
		const target = { ...notes, track: "stable" as const, previousVersion: "1.2.2" };
		const fetchNotes = vi.fn(async () => new Response(JSON.stringify(target), { status: 200 }));
		const { service, updater } = createService({
			track: "stable",
			fetch: fetchNotes as typeof fetch,
		});
		service.start();
		await service.check();
		updater.emit("update-downloaded", {}, "", target.version, new Date(), "");

		await vi.waitFor(() => expect(service.state.status).toBe("downloaded"));
		expect(service.state.releaseNotes).toEqual([target]);
		expect(fetchNotes).toHaveBeenCalledOnce();
		service.dispose();
	});

	it("rejects concurrent checks and installs only downloaded updates", async () => {
		vi.useFakeTimers();
		const { service, updater } = createService();
		service.start();
		expect((await service.check()).accepted).toBe(true);
		expect((await service.check()).accepted).toBe(false);
		expect(service.install().accepted).toBe(false);
		updater.emit("update-downloaded", {}, "", notes.version, new Date(), "");
		await vi.waitFor(() => expect(service.state.status).toBe("downloaded"));
		expect(service.install().accepted).toBe(true);
		expect(updater.quitAndInstall).toHaveBeenCalledOnce();
		service.dispose();
	});

	it("uses the shutdown barrier and keeps the ready state when installation fails", async () => {
		vi.useFakeTimers();
		const installWithShutdown = vi.fn((install: () => void) => install());
		const updater = new FakeNativeUpdater();
		updater.quitAndInstall.mockImplementation(() => {
			throw new Error("installer failed");
		});
		const { service } = createService({ updater, installWithShutdown });
		service.start();
		updater.emit("update-downloaded", {}, "", notes.version, new Date(), "");
		await vi.waitFor(() => expect(service.state.status).toBe("downloaded"));

		const result = service.install();

		expect(installWithShutdown).toHaveBeenCalledOnce();
		expect(updater.quitAndInstall).toHaveBeenCalledOnce();
		expect(result.accepted).toBe(true);
		expect(result.state).toMatchObject({ status: "downloaded", message: expect.any(String) });
		service.dispose();
	});

	it("reports disabled state outside supported packaged builds", () => {
		const { service, updater } = createService({ isPackaged: false });
		service.start();
		expect(service.state).toMatchObject({ enabled: false, status: "disabled" });
		expect(updater.setFeedURL).not.toHaveBeenCalled();
	});
});
