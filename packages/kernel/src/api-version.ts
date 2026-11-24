/**
 * The version of the plugin API this kernel offers: the sdk, the manifest and
 * the kernel's own extension points and domain objects. An external plugin
 * names the versions it works with in its manifest's `engines["kilo-desktop"]`
 * (a semver range, e.g. `^1.0`), and is not loaded when this falls outside it.
 * Bump the major version for a change that breaks existing plugins.
 */
export const KERNEL_API_VERSION = "1.0.0";
