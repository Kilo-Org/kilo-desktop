/**
 * Renderer entry for the todos plugin.
 *
 * `TodoList` is the page component named by the manifest route (plugin.json
 * `routes[].component`) — the shell resolves it from this module and mounts
 * it when /todos is visited. The plugin never imports the router; navigation
 * happens through `sdk.navigate` (Decision #19).
 *
 * `TodoNavIcon` is the nav icon component named by the manifest nav entry
 * (plugin.json `nav[].icon`) — the shell resolves it from this module and
 * renders it in the sidebar.
 *
 * Electron-only (Decision #7): there is deliberately no `browserRegister` —
 * the backend needs SQLite in the main process, so standalone browser mode
 * skips this plugin with the standard warning and the shell renders an
 * explicit unavailable state for the /todos route.
 */
export { TodoList } from "./TodoList.js";

export { TodoNavIcon } from "./TodoNavIcon.js";
