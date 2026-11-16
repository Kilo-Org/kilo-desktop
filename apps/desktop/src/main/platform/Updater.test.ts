import { EventEmitter } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ReleaseTrack } from "$config/release.js";
import type { DesktopReleaseNotes } from "$config/release-notes.js";

import { DesktopUpdaterService, type DesktopUpdateState } from "./Updater.js";
import { UpdateFeedError, type WindowsUpdateFeed } from "./WindowsUpdateFeed.js";

type FakeWindowsFeed = Pick<WindowsUpdateFeed, "directory" | "prepare" | "clear">;

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
		arch?: string;
		publishUrls?: Readonly<Record<ReleaseTrack, string>>;
		fetch?: typeof fetch;
		updater?: FakeNativeUpdater;
		installWithShutdown?: (install: () => void) => void;
		persistTrack?: (track: ReleaseTrack) => void;
		track?: ReleaseTrack;
		currentVersion?: string;
		windowsFeed?: FakeWindowsFeed;
	} = {},
) {
	const updater = overrides.updater ?? new FakeNativeUpdater();
	const states: DesktopUpdateState[] = [];
	const service = new DesktopUpdaterService({
		isPackaged: overrides.isPackaged ?? true,
		platform: overrides.platform ?? "darwin",
		arch: overrides.arch ?? "arm64",
		track: overrides.track ?? "preview",
		currentVersion: overrides.currentVersion ?? "1.2.2",
		publishUrls: overrides.publishUrls ?? {
			preview: "https://updates.example.com",
			stable: "https://stable.example.com",
		},
		installWithShutdown: overrides.installWithShutdown ?? ((install) => install()),
		fetch:
			overrides.fetch ??
			((async () => new Response(JSON.stringify(notes), { status: 200 })) as typeof fetch),
		broadcast: (state) => states.push(state),
		persistTrack: overrides.persistTrack ?? vi.fn(),
		logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
		updater: updater as never,
		...(overrides.windowsFeed && { windowsFeed: overrides.windowsFeed }),
	});
	return { service, updater, states };
}

function createWindowsFeed(prepare: FakeWindowsFeed["prepare"]): FakeWindowsFeed {
	return {
		directory: "C:\\Users\\me\\AppData\\Roaming\\Kilo\\squirrel-feed",
		prepare,
		clear: vi.fn(async () => {}),
	};
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
			url: "https://updates.example.com/kilo-desktop-ci-test/preview/darwin/arm64/RELEASES.json",
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

	it("keeps every published release-note item", async () => {
		vi.useFakeTimers();
		const items = Array.from({ length: 20 }, (_, index) => `Change ${index + 1}`);
		const { service, updater } = createService({
			fetch: (async () =>
				new Response(JSON.stringify({ ...notes, items }), { status: 200 })) as typeof fetch,
		});
		service.start();
		expect((await service.check()).accepted).toBe(true);
		updater.emit("update-downloaded", {}, "", notes.version, new Date(), "");
		await vi.waitFor(() => expect(service.state.releaseNotes[0]?.items).toEqual(items));
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
		const fetchNotes = vi.fn(async () => new Response(JSON.stringify(stableNotes)));
		const { service, updater, states } = createService({
			persistTrack,
			fetch: fetchNotes as typeof fetch,
		});
		service.start();

		const result = await service.setTrack("stable");

		expect(result.accepted).toBe(true);
		expect(persistTrack).toHaveBeenCalledWith("stable");
		expect(updater.setFeedURL).toHaveBeenLastCalledWith({
			url: "https://stable.example.com/kilo-desktop-ci-test/latest/darwin/arm64/RELEASES.json",
			serverType: "json",
		});
		expect(fetchNotes).toHaveBeenLastCalledWith(
			"https://stable.example.com/kilo-desktop-ci-test/latest/release-notes/latest.json",
			expect.anything(),
		);
		expect(updater.checkForUpdates).toHaveBeenCalledOnce();
		expect(service.state).toMatchObject({ track: "stable", status: "checking" });
		expect(states).toContainEqual(expect.objectContaining({ track: "stable", status: "idle" }));
		service.dispose();
	});

	it("rejects switching to a track whose update host this build does not know", async () => {
		vi.useFakeTimers();
		const persistTrack = vi.fn();
		const { service, updater } = createService({
			persistTrack,
			publishUrls: { preview: "https://updates.example.com", stable: "" },
		});
		service.start();
		updater.setFeedURL.mockClear();

		const result = await service.setTrack("stable");

		expect(result).toMatchObject({
			accepted: false,
			state: { track: "preview", message: expect.stringContaining("Stable") },
		});
		expect(persistTrack).not.toHaveBeenCalled();
		expect(updater.setFeedURL).not.toHaveBeenCalled();
		expect(updater.checkForUpdates).not.toHaveBeenCalled();
		service.dispose();
	});

	it("reports disabled state when the selected track has no update host", () => {
		const { service, updater } = createService({
			track: "stable",
			publishUrls: { preview: "https://updates.example.com", stable: "" },
		});
		service.start();
		expect(service.state).toMatchObject({ enabled: false, status: "disabled" });
		expect(updater.setFeedURL).not.toHaveBeenCalled();
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
			url: "https://updates.example.com/kilo-desktop-ci-test/preview/darwin/arm64/RELEASES.json",
			serverType: "json",
		});
		expect(service.state.track).toBe("preview");
		service.dispose();
	});
});

describe("DesktopUpdaterService on Linux", () => {
	const debUrl = (host: string, channel: string, arch: string) =>
		`${host}/kilo-desktop/${channel}/linux/${arch}/kilo-desktop_${notes.version}_${arch}.deb`;
	const download = (
		arch: string,
		url = debUrl("https://updates.example.com", "preview", arch),
	) => ({
		platform: "linux" as const,
		arch,
		type: "deb" as const,
		fileName: "kilo-desktop.deb",
		url,
		size: 1024,
		sha256: "abc123",
	});
	const manifest = {
		schemaVersion: 1 as const,
		track: "preview" as const,
		version: notes.version,
		publishedAt: notes.publishedAt,
		releaseNotesUrl: `https://updates.example.com/kilo-desktop-ci-test/preview/release-notes/${notes.version}.json`,
		downloads: [
			download("x64"),
			download("arm64"),
			{ ...download("arm64"), platform: "macos" as const, type: "dmg" as const },
		],
	};

	interface Documents {
		manifest?: unknown;
		notes?: unknown;
		/** Answers manifest requests with this HTTP status instead of the manifest. */
		manifestStatus?: number;
		/** Leaves manifest requests pending until their signal aborts. */
		hangManifest?: boolean;
	}

	/**
	 * Serves the track manifest and release notes like the update host does.
	 * `documents` is read on every request, so a test can change it between checks.
	 */
	function serve(documents: Documents = {}) {
		return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
			const url = String(input);
			const isManifest = url.endsWith("/latest.json") && !url.includes("/release-notes/");
			if (isManifest && documents.hangManifest) {
				return new Promise<Response>((_, reject) => {
					init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
				});
			}
			if (isManifest && documents.manifestStatus) {
				return new Response("unavailable", { status: documents.manifestStatus });
			}
			const body = url.includes("/release-notes/")
				? (documents.notes ?? notes)
				: isManifest
					? (documents.manifest ?? manifest)
					: undefined;
			return body === undefined
				? new Response("missing", { status: 404 })
				: new Response(JSON.stringify(body), { status: 200 });
		});
	}

	const releaseNoteRequests = (fetchDocuments: ReturnType<typeof serve>) =>
		fetchDocuments.mock.calls.filter(([input]) => String(input).includes("/release-notes/")).length;

	/** A Linux service that has already offered the preview package. */
	async function offered(documents: Documents = {}) {
		vi.useFakeTimers();
		const fetchDocuments = serve(documents);
		const created = createService({ platform: "linux", fetch: fetchDocuments as typeof fetch });
		created.service.start();
		await created.service.check();
		expect(created.service.state.status).toBe("available");
		return { ...created, fetchDocuments, offeredAt: created.states.length };
	}

	it("checks without the native updater and offers this architecture's package", async () => {
		vi.useFakeTimers();
		const fetchDocuments = serve();
		const { service, updater } = createService({
			platform: "linux",
			arch: "arm64",
			fetch: fetchDocuments as typeof fetch,
		});
		service.start();
		expect(service.state).toMatchObject({ enabled: true, status: "idle", downloadUrl: null });
		expect(updater.setFeedURL).not.toHaveBeenCalled();

		expect((await service.check()).accepted).toBe(true);

		expect(fetchDocuments).toHaveBeenCalledWith(
			"https://updates.example.com/kilo-desktop-ci-test/preview/latest.json",
			expect.anything(),
		);
		expect(service.state).toMatchObject({
			status: "available",
			availableVersion: notes.version,
			downloadedVersion: null,
			downloadUrl: debUrl("https://updates.example.com", "preview", "arm64"),
			releaseNotes: [notes],
		});
		expect(updater.checkForUpdates).not.toHaveBeenCalled();
		expect(service.install().accepted).toBe(false);
		expect(updater.quitAndInstall).not.toHaveBeenCalled();
		service.dispose();
	});

	it("reports up to date when the published version is not newer", async () => {
		vi.useFakeTimers();
		const { service } = createService({
			platform: "linux",
			currentVersion: notes.version,
			fetch: serve() as typeof fetch,
		});
		service.start();

		await service.check();

		expect(service.state).toMatchObject({
			status: "up-to-date",
			availableVersion: null,
			downloadUrl: null,
		});
		service.dispose();
	});

	it("says when a newer release has no package for this architecture yet", async () => {
		vi.useFakeTimers();
		const { service } = createService({
			platform: "linux",
			arch: "arm64",
			fetch: serve({ manifest: { ...manifest, downloads: [download("x64")] } }) as typeof fetch,
		});
		service.start();

		await service.check();

		expect(service.state).toMatchObject({
			status: "error",
			availableVersion: null,
			downloadUrl: null,
			message: `Version ${notes.version} has no Linux package for arm64 yet. Try again later.`,
		});
		service.dispose();
	});

	it("never offers a package hosted outside the track's update host", async () => {
		vi.useFakeTimers();
		const offHost = download("arm64", debUrl("https://downloads.example.net", "preview", "arm64"));
		const { service } = createService({
			platform: "linux",
			fetch: serve({ manifest: { ...manifest, downloads: [offHost] } }) as typeof fetch,
		});
		service.start();

		await service.check();

		expect(service.state).toMatchObject({
			status: "error",
			downloadUrl: null,
			message: expect.stringContaining("no Linux package"),
		});
		service.dispose();
	});

	it("reports a failed check when the manifest is unavailable or malformed", async () => {
		vi.useFakeTimers();
		for (const [documents, message] of [
			[{ manifestStatus: 503 }, /update check failed\. The update server responded with HTTP 503/],
			[{ manifest: { ...manifest, track: "stable" } }, /update check failed/],
			[{ manifest: { ...manifest, version: "latest" } }, /update check failed/],
		] as const) {
			const { service } = createService({
				platform: "linux",
				fetch: serve(documents) as typeof fetch,
			});
			service.start();

			await service.check();

			expect(service.state).toMatchObject({
				status: "error",
				message: expect.stringMatching(message),
			});
			expect((await service.check()).accepted).toBe(true);
			service.dispose();
		}
	});

	it.each<[string, Documents]>([
		["the manifest is unavailable", { manifestStatus: 503 }],
		[
			"a newer release has no package for this architecture yet",
			{
				manifest: {
					...manifest,
					version: "1.2.4-preview-260827-12000",
					downloads: [download("x64")],
				},
			},
		],
	])("quietly keeps the offer when, in the background, %s", async (_, change) => {
		const documents: Documents = {};
		const { service, states, offeredAt } = await offered(documents);
		const offer = service.state;
		Object.assign(documents, change);

		await vi.advanceTimersByTimeAsync(10 * 60_000);

		expect(states.slice(offeredAt)).toEqual([]);
		expect(service.state).toEqual(offer);
		service.dispose();
	});

	it("reuses the release notes while the offered version is unchanged", async () => {
		const documents: Documents = {};
		const { service, fetchDocuments } = await offered(documents);
		const requested = releaseNoteRequests(fetchDocuments);
		documents.notes = { unavailable: true };

		await vi.advanceTimersByTimeAsync(10 * 60_000);

		expect(releaseNoteRequests(fetchDocuments)).toBe(requested);
		expect(service.state.releaseNotes).toEqual([notes]);
		service.dispose();
	});

	it("lets a track change cancel a background check", async () => {
		const persistTrack = vi.fn();
		const stableDeb = download("arm64", debUrl("https://stable.example.com", "latest", "arm64"));
		const documents: Documents = {};
		vi.useFakeTimers();
		const fetchDocuments = serve(documents);
		const { service } = createService({
			platform: "linux",
			persistTrack,
			fetch: fetchDocuments as typeof fetch,
		});
		service.start();
		await service.check();
		documents.hangManifest = true;
		await vi.advanceTimersByTimeAsync(10 * 60_000);

		documents.hangManifest = false;
		documents.manifest = { ...manifest, track: "stable", version: "1.3.0", downloads: [stableDeb] };
		documents.notes = { ...notes, track: "stable", version: "1.3.0" };
		const result = await service.setTrack("stable");

		expect(result.accepted).toBe(true);
		expect(persistTrack).toHaveBeenCalledWith("stable");
		expect(service.state).toMatchObject({
			track: "stable",
			status: "available",
			availableVersion: "1.3.0",
			downloadUrl: stableDeb.url,
		});
		service.dispose();
	});

	it("still offers the package when its release notes are unavailable", async () => {
		vi.useFakeTimers();
		const fetchDocuments = vi.fn(async (input: string | URL | Request) =>
			String(input).includes("/release-notes/")
				? new Response("unavailable", { status: 503 })
				: new Response(JSON.stringify(manifest), { status: 200 }),
		);
		const { service } = createService({ platform: "linux", fetch: fetchDocuments as typeof fetch });
		service.start();

		await service.check();

		expect(service.state).toMatchObject({ status: "available", releaseNotes: [] });
		service.dispose();
	});

	it("switches tracks and checks the new track's manifest", async () => {
		vi.useFakeTimers();
		const persistTrack = vi.fn();
		const stableNotes = { ...notes, track: "stable" as const, version: "1.3.0" };
		const stableDeb = download("arm64", debUrl("https://stable.example.com", "latest", "arm64"));
		const fetchDocuments = serve({
			manifest: { ...manifest, track: "stable", version: "1.3.0", downloads: [stableDeb] },
			notes: stableNotes,
		});
		const { service, updater } = createService({
			platform: "linux",
			persistTrack,
			fetch: fetchDocuments as typeof fetch,
		});
		service.start();

		const result = await service.setTrack("stable");

		expect(result.accepted).toBe(true);
		expect(persistTrack).toHaveBeenCalledWith("stable");
		expect(updater.setFeedURL).not.toHaveBeenCalled();
		expect(fetchDocuments).toHaveBeenCalledWith(
			"https://stable.example.com/kilo-desktop-ci-test/latest/latest.json",
			expect.anything(),
		);
		expect(service.state).toMatchObject({
			track: "stable",
			status: "available",
			availableVersion: "1.3.0",
			downloadUrl: stableDeb.url,
		});
		service.dispose();
	});
});

describe("DesktopUpdaterService on Windows", () => {
	it("downloads into the local mirror, then lets Squirrel install from it", async () => {
		vi.useFakeTimers();
		const windowsFeed = createWindowsFeed(
			vi.fn<FakeWindowsFeed["prepare"]>(async ({ onDownloadStart }) => {
				onDownloadStart(notes.version);
				return { kind: "ready", version: notes.version };
			}),
		);
		const { service, updater } = createService({ platform: "win32", windowsFeed });
		service.start();
		expect(updater.setFeedURL).toHaveBeenCalledWith({ url: windowsFeed.directory });

		await service.check();

		expect(windowsFeed.prepare).toHaveBeenCalledWith(
			expect.objectContaining({
				remoteFeedUrl: "https://updates.example.com/kilo-desktop-ci-test/preview/win32/arm64",
				currentVersion: "1.2.2",
			}),
		);
		expect(service.state).toMatchObject({ status: "downloading", availableVersion: notes.version });
		expect(updater.checkForUpdates).toHaveBeenCalledOnce();
		updater.emit("checking-for-update");
		expect(service.state.status).toBe("downloading");

		updater.emit("update-downloaded", {}, "", notes.version, new Date(), "");
		await vi.waitFor(() => expect(service.state.status).toBe("downloaded"));
		await vi.waitFor(() => expect(windowsFeed.clear).toHaveBeenCalledOnce());
		service.dispose();
	});

	it("reports up to date without invoking Squirrel", async () => {
		vi.useFakeTimers();
		const windowsFeed = createWindowsFeed(vi.fn(async () => ({ kind: "up-to-date" as const })));
		const { service, updater } = createService({ platform: "win32", windowsFeed });
		service.start();

		await service.check();

		expect(service.state.status).toBe("up-to-date");
		expect(updater.checkForUpdates).not.toHaveBeenCalled();
		expect((await service.check()).accepted).toBe(true);
		service.dispose();
	});

	it("names the HTTP status when the update server refuses the request", async () => {
		vi.useFakeTimers();
		const windowsFeed = createWindowsFeed(
			vi.fn(async () => {
				throw new UpdateFeedError("The update server returned HTTP 403.", 403);
			}),
		);
		const { service, updater } = createService({ platform: "win32", windowsFeed });
		service.start();

		await service.check();

		expect(service.state).toMatchObject({
			status: "error",
			message: expect.stringContaining("HTTP 403"),
		});
		expect(updater.checkForUpdates).not.toHaveBeenCalled();
		service.dispose();
	});
});
