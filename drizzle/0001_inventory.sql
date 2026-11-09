CREATE TABLE `camera` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token` text,
	`brand` text NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'point-and-shoot' NOT NULL,
	`format` text DEFAULT '35mm' NOT NULL,
	`mount` text,
	`fixed_lens` text,
	`battery` text,
	`battery_changed_on` text,
	`serial` text,
	`acquired_on` text,
	`price_cents` integer,
	`acquired_from` text,
	`status` text DEFAULT 'active' NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `camera_user_idx` ON `camera` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `camera_user_token_idx` ON `camera` (`user_id`,`token`);--> statement-breakpoint
CREATE TABLE `film_stock` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token` text,
	`brand` text NOT NULL,
	`name` text NOT NULL,
	`iso` integer,
	`process` text DEFAULT 'C-41' NOT NULL,
	`format` text DEFAULT '35mm' NOT NULL,
	`exposures` integer DEFAULT 36 NOT NULL,
	`wishlist` integer DEFAULT false NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `film_stock_user_idx` ON `film_stock` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `film_stock_user_token_idx` ON `film_stock` (`user_id`,`token`);--> statement-breakpoint
CREATE TABLE `lab` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token` text,
	`name` text NOT NULL,
	`location` text,
	`url` text,
	`cost_cents` integer,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `lab_user_idx` ON `lab` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `lab_user_token_idx` ON `lab` (`user_id`,`token`);--> statement-breakpoint
CREATE TABLE `lens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`brand` text NOT NULL,
	`name` text NOT NULL,
	`mount` text NOT NULL,
	`focal_min` integer,
	`focal_max` integer,
	`max_aperture` real,
	`serial` text,
	`acquired_on` text,
	`price_cents` integer,
	`acquired_from` text,
	`status` text DEFAULT 'active' NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `lens_user_idx` ON `lens` (`user_id`);--> statement-breakpoint
CREATE TABLE `roll` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`code` text NOT NULL,
	`stock_id` text NOT NULL,
	`exposures` integer DEFAULT 36 NOT NULL,
	`title` text,
	`status` text DEFAULT 'storage' NOT NULL,
	`status_on` text NOT NULL,
	`expires` text,
	`purchased_on` text,
	`price_cents` integer,
	`purchased_from` text,
	`storage_spot` text,
	`camera_id` text,
	`shot_at_iso` integer,
	`lab_id` text,
	`lab_order` text,
	`dev_cost_cents` integer,
	`dev_notes` text,
	`negatives_at` text,
	`public_roll_id` text,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`stock_id`) REFERENCES `film_stock`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`camera_id`) REFERENCES `camera`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`lab_id`) REFERENCES `lab`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `roll_user_status_idx` ON `roll` (`user_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `roll_user_code_idx` ON `roll` (`user_id`,`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `roll_user_public_idx` ON `roll` (`user_id`,`public_roll_id`);--> statement-breakpoint
CREATE TABLE `roll_event` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`roll_id` text NOT NULL,
	`status` text NOT NULL,
	`on` text NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`roll_id`) REFERENCES `roll`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `roll_event_roll_idx` ON `roll_event` (`roll_id`);--> statement-breakpoint
CREATE TABLE `service_log` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`camera_id` text,
	`lens_id` text,
	`on` text NOT NULL,
	`kind` text NOT NULL,
	`cost_cents` integer,
	`note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`camera_id`) REFERENCES `camera`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lens_id`) REFERENCES `lens`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `service_log_camera_idx` ON `service_log` (`camera_id`);--> statement-breakpoint
CREATE INDEX `service_log_lens_idx` ON `service_log` (`lens_id`);