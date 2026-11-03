// Test fixture for plugins that contribute to kilo.updates' points (e.g.
// About → Support rows): kilo.updates as a guest of kilo.shell's test host.
import manifest from "../../plugin.json";
import { UPDATES_DEFINITIONS } from "../contracts";
import { updatesWebEntry } from "../web";

export const updatesTestPlugin = {
	manifest,
	definitions: UPDATES_DEFINITIONS,
	web: updatesWebEntry,
};
