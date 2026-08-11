import type { ComponentType } from "react";

import { NotebookView } from "./notebook/NotebookView.js";

export interface PluginSidecarProps {
	readonly search: Record<string, unknown>;
}

function notebookPathFromSearch(search: Record<string, unknown>): string | undefined {
	const value = search["notebookPath"];
	return typeof value === "string" && value.trim() ? value : undefined;
}

function NotebookSidecar({ search }: PluginSidecarProps) {
	const notebookPath = notebookPathFromSearch(search);
	return (
		<NotebookView {...(notebookPath === undefined ? {} : { notebookPath })} variant="sidecar" />
	);
}

/** Host-owned companion surfaces that plugin routes may request by name. */
export const BUILT_IN_SIDECARS: Readonly<Record<string, ComponentType<PluginSidecarProps>>> = {
	notebook: NotebookSidecar,
};
