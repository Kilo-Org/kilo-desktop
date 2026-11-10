import { defineObjectType } from "@kilo-desktop/kernel";

/**
 * Object types kilo.work-sessions owns without a collection: openers,
 * mentions and drag-and-drop refer to files and web pages through them, and
 * `Panes.openObject` routes them to a pane kind.
 */

/** A file or folder, usually in a workspace folder; the id is its absolute path. */
export const FileObjectType = defineObjectType({
	id: "kilo.work-sessions/file",
	description: "A file or folder, keyed by its absolute path.",
});

/** A web page; the id is its URL. */
export const UrlObjectType = defineObjectType({
	id: "kilo.work-sessions/url",
	description: "A web page, keyed by its URL.",
});
