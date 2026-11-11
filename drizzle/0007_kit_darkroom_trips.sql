CREATE TABLE `battery_stock` (
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`on_hand` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `type`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `chemistry` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`mixed_on` text NOT NULL,
	`capacity_rolls` integer,
	`rolls_used` integer DEFAULT 0 NOT NULL,
	`life_days` integer,
	`retired_on` text,
	`notes` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `chemistry_user_idx` ON `chemistry` (`user_id`);--> statement-breakpoint
CREATE TABLE `dev_recipe` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`spec` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `dev_recipe_user_idx` ON `dev_recipe` (`user_id`);--> statement-breakpoint
CREATE TABLE `trip` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`place` text,
	`lat` real,
	`lng` real,
	`start_on` text NOT NULL,
	`end_on` text NOT NULL,
	`plan` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `trip_user_idx` ON `trip` (`user_id`);--> statement-breakpoint
ALTER TABLE `camera` ADD `shutter_fastest` text;--> statement-breakpoint
ALTER TABLE `camera` ADD `shutter_slowest` text;--> statement-breakpoint
ALTER TABLE `lab` ADD `home` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `roll` ADD `lens_id` text REFERENCES lens(id);--> statement-breakpoint
ALTER TABLE `roll` ADD `dev_run` text;--> statement-breakpoint
ALTER TABLE `service_log` ADD `cells_from_stock` integer;