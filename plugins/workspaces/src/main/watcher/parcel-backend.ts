/** The subset of @parcel/watcher's `BackendType` we pin. */
export type WatcherBackend = "windows" | "inotify" | "fs-events";

const PINNED_BACKENDS: Partial<Record<NodeJS.Platform, WatcherBackend>> = {
	win32: "windows",
	linux: "inotify",
	darwin: "fs-events",
};

/**
 * The native backend to request from parcel, mirroring vscode
 * (`parcelWatcher.ts` PARCEL_WATCHER_BACKEND). Parcel's `"default"` backend
 * probes for watchman via `popen("watchman … get-sockname")` — a visible
 * `cmd.exe` spawn on Windows — whenever it builds its shared backend, which
 * recurs after every errored subscription. Other platforms (FreeBSD) keep
 * parcel's default selection: it has no pinnable kqueue backend type.
 */
export function parcelBackend(platform: NodeJS.Platform): WatcherBackend | undefined {
	return PINNED_BACKENDS[platform];
}
