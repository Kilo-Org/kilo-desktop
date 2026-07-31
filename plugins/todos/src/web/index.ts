/**
 * Renderer entry for the todos plugin.
 *
 * Electron-only (Decision #7): there is deliberately no `browserRegister` —
 * the backend needs SQLite in the main process, so standalone browser mode
 * skips this plugin with the standard warning and the shell's /todos route
 * renders an explicit unavailable state.
 */
export { TodoList } from "./TodoList.js";
