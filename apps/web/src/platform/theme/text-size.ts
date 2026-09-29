import {
	normalizeTextSizes,
	TEXT_SIZE_CSS_VARS,
	TEXT_SIZE_STORAGE_KEY,
	type TextSizes,
	type TextSizeTarget,
} from "@kilo-desktop/contracts";

export function readStoredTextSizes(): TextSizes {
	try {
		const stored = globalThis.localStorage.getItem(TEXT_SIZE_STORAGE_KEY);
		return normalizeTextSizes(stored === null ? null : JSON.parse(stored));
	} catch {
		return normalizeTextSizes(null);
	}
}

export function persistTextSizes(sizes: TextSizes): void {
	try {
		globalThis.localStorage.setItem(TEXT_SIZE_STORAGE_KEY, JSON.stringify(sizes));
	} catch {
		// Best-effort persistence; the in-memory state still applies for this session.
	}
}

export function applyTextSizes(sizes: TextSizes): void {
	const style = document.documentElement.style;
	for (const target of Object.keys(TEXT_SIZE_CSS_VARS) as TextSizeTarget[]) {
		style.setProperty(TEXT_SIZE_CSS_VARS[target], `${sizes[target]}px`);
	}
}
