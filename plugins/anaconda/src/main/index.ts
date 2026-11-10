import { createAnacondaMainEntry } from "./entry";

export { createAnacondaMainEntry, type AnacondaMainOptions } from "./entry";

/** kilo.anaconda's main entry, on the user's Anaconda keyring and the build's OAuth client. */
export const anacondaMainEntry = createAnacondaMainEntry({
	clientId: import.meta.env.VITE_AUTH_CLIENT_ID ?? "",
});
