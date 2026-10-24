CREATE TABLE `mutation_limits` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`window` integer NOT NULL,
	`count` integer NOT NULL,
	CONSTRAINT "mutation_window_bounds" CHECK("mutation_limits"."window" >= 0),
	CONSTRAINT "mutation_count_bounds" CHECK("mutation_limits"."count" >= 1 AND "mutation_limits"."count" <= 31)
);
--> statement-breakpoint
CREATE TABLE `vaults` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`vault_id` text NOT NULL,
	`revision` integer NOT NULL,
	`envelope` text NOT NULL,
	`last_operation_id` text NOT NULL,
	`digest` text NOT NULL,
	CONSTRAINT "vaults_revision_bounds" CHECK("vaults"."revision" >= 1 AND "vaults"."revision" <= 2147483647),
	CONSTRAINT "vaults_envelope_size" CHECK(length("vaults"."envelope") <= 1048576)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vaults_vault_id_unique` ON `vaults` (`vault_id`);