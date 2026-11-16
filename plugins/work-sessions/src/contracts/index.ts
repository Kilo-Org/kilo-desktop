import type { PluginDefinitions } from "@kilo-desktop/kernel";

import {
	FileObjectType,
	FileWatcher,
	Opener,
	PaneObjectType,
	Panes,
	UrlObjectType,
	Vcs,
	WorkSessionObjectType,
	WorkSessions,
	WorkspaceObjectType,
	Workspaces,
} from "./model";
import {
	LayoutPresets,
	NewWorkSessionOption,
	NewWorkSessionSection,
	PaneKind,
	PermissionAutoAnswer,
	WorkSessionAction,
	WorkSessionDecoration,
	WorkSessionFacet,
	WorkSessionListAction,
	WorkSessionMenu,
	WorkSessionStarter,
	WorkSessionsView,
	WorkSessionsWindow,
} from "./ui";

export * from "./model";
export * from "./ui";

/**
 * kilo.work-sessions' public surface: workspaces (named projects of one or
 * more folders, with path authorisation for every plugin), the work sessions
 * people work in (a workspace, where they work, the Kilo chats stamped with
 * their id) and the panes they hold — and everything the user sees of them:
 * workspace management, the session list, the canvas and the New Session
 * page.
 *
 * The model (`./model`: zod schemas, the main-home domain objects, the `vcs`
 * and `opener` extension points, object types) carries no React, so main
 * code — this plugin's and other plugins' — imports only from it. The UI
 * (`./ui`: renderer extension points and their props, each window's
 * `window` object, layout presets, commands) sits on top. Isolation is
 * generic: a work session records `local`, `new-copy` or `existing-copy` and
 * its directory, and the `vcs` contribution (kilo.git) makes the copies.
 * Chats belong to a work session through kilo.core's chat stamp
 * (`ChatSummary.workSessionId`); kilo.core treats the id as opaque.
 */
export const WORK_SESSIONS_PLUGIN_ID = "kilo.work-sessions";

export const WORK_SESSIONS_DEFINITIONS: PluginDefinitions = {
	extensionPoints: [
		Vcs,
		Opener,
		PaneKind,
		WorkSessionMenu,
		WorkSessionDecoration,
		WorkSessionFacet,
		WorkSessionsView,
		WorkSessionAction,
		WorkSessionListAction,
		NewWorkSessionOption,
		NewWorkSessionSection,
		WorkSessionStarter,
		PermissionAutoAnswer,
	],
	domainObjects: [Workspaces, FileWatcher, WorkSessions, Panes, WorkSessionsWindow, LayoutPresets],
	objectTypes: [
		WorkspaceObjectType,
		WorkSessionObjectType,
		PaneObjectType,
		FileObjectType,
		UrlObjectType,
	],
};
