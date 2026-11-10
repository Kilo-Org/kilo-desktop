import { z } from "zod";

import { isLocalName, isPluginId, isQualifiedId } from "./ids";
import { HOST_PERMISSIONS } from "./permissions";
import { whenSchema } from "./when";

const pluginId = z.string().refine(isPluginId, "Plugin ids are dotted publisher.name");
const localName = z.string().refine(isLocalName, "Invalid local name");
const qualifiedId = z.string().refine(isQualifiedId, "Expected a qualified id: <owner>/<local>");
const contextKeyName = z
	.string()
	.refine(
		(value) => isLocalName(value.endsWith("*") ? `${value.slice(0, -1)}x` : value),
		"Invalid context key name",
	);
const scheme = z.string().regex(/^[a-z][a-z0-9+.-]*$/, "Invalid URL scheme");
const semver = z
	.string()
	.regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/, "Expected a semver version");

export const manifestSchema = z.strictObject({
	manifestVersion: z.literal(1),
	id: pluginId,
	displayName: z.string().min(1),
	version: semver,
	description: z.string().optional(),
	engines: z.strictObject({ "kilo-desktop": z.string().min(1) }).optional(),
	/** Informational entry paths; bundled entries are wired by the plugin list. */
	main: z.string().optional(),
	web: z.string().optional(),
	/**
	 * Runs the plugin only while this holds (e.g. a feature flag's context key):
	 * the kernel activates it, with its contributions, when it becomes true and
	 * deactivates it when it turns false. Use global keys.
	 */
	when: whenSchema.optional(),
	/** Extension points and domain objects this plugin needs, by qualified id. */
	requires: z.record(qualifiedId, z.enum(["required", "optional"])).optional(),
	permissions: z
		.strictObject({
			host: z.array(z.enum(HOST_PERMISSIONS)).optional(),
			protocols: z.array(scheme).optional(),
			embeddedHosts: z.array(localName).optional(),
		})
		.optional(),
	contextKeys: z
		.array(
			z.strictObject({
				id: contextKeyName,
				scope: z.enum(["global", "window"]).default("global"),
				description: z.string().optional(),
			}),
		)
		.optional(),
	extensionPoints: z
		.array(
			z.strictObject({
				id: localName,
				kind: z.enum(["additive", "exclusive", "decision"]),
				description: z.string().optional(),
			}),
		)
		.optional(),
	domainObjects: z
		.array(
			z.strictObject({
				id: localName,
				home: z.enum(["main", "renderer"]),
				description: z.string().optional(),
				/** The object type this collection resolves. */
				objectType: qualifiedId.optional(),
			}),
		)
		.optional(),
	objectTypes: z
		.array(z.strictObject({ id: localName, description: z.string().optional() }))
		.optional(),
	contributes: z
		.strictObject({
			extensions: z.record(qualifiedId, z.array(z.record(z.string(), z.unknown()))).optional(),
		})
		.optional(),
});

export type PluginManifest = z.output<typeof manifestSchema>;
