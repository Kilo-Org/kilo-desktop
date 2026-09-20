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
		persistTrack?: (track: ReleaseTrack) => void;
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
		persistTrack: overrides.persistTrack ?? vi.fn(),
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

	it("recovers release notes after the update is already downloaded", async () => {
		vi.useFakeTimers();
		const fetchNotes = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
			.mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
			.mockResolvedValueOnce(new Response(JSON.stringify(notes), { status: 200 }));
		const { service, updater } = createService({ fetch: fetchNotes });
		service.start();
		await service.check();
		updater.emit("update-downloaded", {}, "", notes.version, new Date(), "");
		await vi.waitFor(() => expect(service.state.status).toBe("downloaded"));
		expect(service.state.releaseNotes).toEqual([]);

		await vi.advanceTimersByTimeAsync(5_000);

		expect(service.state.releaseNotes).toEqual([notes]);
		expect(updater.checkForUpdates).toHaveBeenCalledOnce();
		service.dispose();
	});

	it("cancels release-note recovery when disposed", async () => {
		vi.useFakeTimers();
		const fetchNotes = vi.fn(async () => new Response("unavailable", { status: 503 }));
		const { service, updater } = createService({ fetch: fetchNotes as typeof fetch });
		service.start();
		updater.emit("update-downloaded", {}, "", notes.version, new Date(), "");
		await vi.waitFor(() => expect(service.state.status).toBe("downloaded"));
		service.dispose();

		await vi.advanceTimersByTimeAsync(60_000);

		expect(fetchNotes).toHaveBeenCalledOnce();
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

	it("persists a new track, repoints the feed, resets state, and checks immediately", async () => {
		vi.useFakeTimers();
		const persistTrack = vi.fn();
		const stableNotes = { ...notes, track: "stable" as const, version: "1.3.0" };
		const { service, updater, states } = createService({
			persistTrack,
			fetch: (async () => new Response(JSON.stringify(stableNotes))) as typeof fetch,
		});
		service.start();

		const result = await service.setTrack("stable");

		expect(result.accepted).toBe(true);
		expect(persistTrack).toHaveBeenCalledWith("stable");
		expect(updater.setFeedURL).toHaveBeenLastCalledWith({
			url: "https://updates.example.com/kilo-desktop/latest/darwin/arm64/RELEASES.json",
			serverType: "json",
		});
		expect(updater.checkForUpdates).toHaveBeenCalledOnce();
		expect(service.state).toMatchObject({ track: "stable", status: "checking" });
		expect(states).toContainEqual(expect.objectContaining({ track: "stable", status: "idle" }));
		service.dispose();
	});

	it("persists track selection without touching the native updater when disabled", async () => {
		const persistTrack = vi.fn();
		const { service, updater } = createService({ isPackaged: false, persistTrack });

		const result = await service.setTrack("stable");

		expect(result).toMatchObject({
			accepted: true,
			state: { track: "stable", status: "disabled" },
		});
		expect(persistTrack).toHaveBeenCalledWith("stable");
		expect(updater.setFeedURL).not.toHaveBeenCalled();
		expect(updater.checkForUpdates).not.toHaveBeenCalled();
	});

	it("rejects track changes while an update action or payload is active", async () => {
		vi.useFakeTimers();
		const persistTrack = vi.fn();
		const { service, updater } = createService({ persistTrack });
		service.start();
		await service.check();

		const checking = await service.setTrack("stable");
		expect(checking).toMatchObject({
			accepted: false,
			state: { track: "preview", message: expect.stringContaining("current update") },
		});
		updater.emit("update-available");
		const downloading = await service.setTrack("stable");
		expect(downloading.accepted).toBe(false);
		expect(persistTrack).not.toHaveBeenCalled();
		service.dispose();
	});

	it("rejects track changes after dispose", async () => {
		const persistTrack = vi.fn();
		const { service, updater } = createService({ persistTrack });
		service.start();
		updater.setFeedURL.mockClear();
		service.dispose();

		const result = await service.setTrack("stable");

		expect(result).toMatchObject({ accepted: false, state: { track: "preview" } });
		expect(persistTrack).not.toHaveBeenCalled();
		expect(updater.setFeedURL).not.toHaveBeenCalled();
		expect(updater.checkForUpdates).not.toHaveBeenCalled();
	});

	it("restores the previous feed when track persistence fails", async () => {
		vi.useFakeTimers();
		const persistTrack = vi.fn(() => {
			throw new Error("disk full");
		});
		const { service, updater } = createService({ persistTrack });
		service.start();

		await expect(service.setTrack("stable")).rejects.toThrow("disk full");
		expect(updater.setFeedURL).toHaveBeenLastCalledWith({
			url: "https://updates.example.com/kilo-desktop/preview/darwin/arm64/RELEASES.json",
			serverType: "json",
		});
		expect(service.state.track).toBe("preview");
		service.dispose();
	});
});
