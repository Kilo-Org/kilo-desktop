-- The initial workspace migration is intentionally restart-safe. Development
-- builds can be terminated between SQLite DDL statements, leaving tables in
-- place before Drizzle records the migration in __drizzle_migrations.
CREATE TABLE IF NOT EXISTS `workspace_folders` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`path` text NOT NULL,
	`is_primary` integer NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `workspace_folders_workspace_path_unique` ON `workspace_folders` (`workspace_id`,`path`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `workspace_folders_workspace_position_idx` ON `workspace_folders` (`workspace_id`,`position`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
