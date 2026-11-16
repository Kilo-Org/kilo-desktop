export const SIDEBAR_WIDTH_DEFAULT = 256;
export const SIDEBAR_WIDTH_MIN = 208;
export const SIDEBAR_WIDTH_VIEWPORT_RESERVE = 640;
export const SIDEBAR_WIDTH_STORAGE_KEY = "shell:sidebar-width";

export function clampSidebarWidth(
	width: number,
	viewportWidth = typeof globalThis.innerWidth === "number" ? globalThis.innerWidth : 1280,
): number {
	const max = Math.max(SIDEBAR_WIDTH_MIN, viewportWidth - SIDEBAR_WIDTH_VIEWPORT_RESERVE);
	return Math.min(max, Math.max(SIDEBAR_WIDTH_MIN, Math.round(width)));
}

export function readStoredSidebarWidth(
	storage: Pick<Storage, "getItem"> | null = getLocalStorage(),
	viewportWidth?: number,
): number {
	if (!storage) return clampSidebarWidth(SIDEBAR_WIDTH_DEFAULT, viewportWidth);
	try {
		const raw = storage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
		const parsed = raw == null ? NaN : Number(raw);
		if (!Number.isFinite(parsed)) return clampSidebarWidth(SIDEBAR_WIDTH_DEFAULT, viewportWidth);
		return clampSidebarWidth(parsed, viewportWidth);
	} catch {
		return clampSidebarWidth(SIDEBAR_WIDTH_DEFAULT, viewportWidth);
	}
}

export function writeStoredSidebarWidth(
	width: number,
	storage: Pick<Storage, "setItem"> | null = getLocalStorage(),
	viewportWidth?: number,
): void {
	if (!storage) return;
	try {
		storage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(clampSidebarWidth(width, viewportWidth)));
	} catch {
		// Ignore quota / private-mode failures.
	}
}

function getLocalStorage(): Storage | null {
	try {
		return globalThis.localStorage;
	} catch {
		return null;
	}
}
