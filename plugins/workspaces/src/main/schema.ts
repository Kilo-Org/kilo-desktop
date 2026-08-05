import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const workspaces = sqliteTable("workspaces", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	createdAt: integer("created_at").notNull(),
	updatedAt: integer("updated_at").notNull(),
});

export const workspaceFolders = sqliteTable(
	"workspace_folders",
	{
		id: text("id").primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		path: text("path").notNull(),
		isPrimary: integer("is_primary", { mode: "boolean" }).notNull(),
		position: integer("position").notNull(),
	},
	(table) => [
		uniqueIndex("workspace_folders_workspace_path_unique").on(table.workspaceId, table.path),
		index("workspace_folders_workspace_position_idx").on(table.workspaceId, table.position),
	],
);
