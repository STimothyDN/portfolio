CREATE TABLE `scan_mark` (
	`user_id` text NOT NULL,
	`public_roll_id` text NOT NULL,
	`filename` text NOT NULL,
	`mark` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `public_roll_id`, `filename`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
