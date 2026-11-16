import { QueryClient } from "@tanstack/react-query";

import type { DomainObjectHandle } from "@kilo-desktop/kernel";

import type { Documents } from "../contracts/index.js";

export type DocumentsHandle = DomainObjectHandle<typeof Documents>;
export type DocumentMethods = DocumentsHandle["methods"];
export type ReadFile = DocumentMethods["read"];
export type WriteFile = DocumentMethods["write"];

/** The window's cache of kilo.files reads, keyed `["kilo.files", …]`. */
export function createFilesQueryClient(): QueryClient {
	return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

/** Thrown by reads while kilo.files' main half is missing (the browser). */
export function documentsUnavailable(): never {
	throw new Error("Files aren't available here.");
}
