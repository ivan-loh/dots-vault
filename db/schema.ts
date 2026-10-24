// Isolated local preparation only. Published version1 has no DB binding/schema.
import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, check, uniqueIndex } from 'drizzle-orm/sqlite-core';
export const vaults = sqliteTable(
  'vaults',
  {
    ownerId: text('owner_id').primaryKey().notNull(),
    vaultId: text('vault_id').notNull(),
    revision: integer('revision').notNull(),
    envelope: text('envelope').notNull(),
    lastOperationId: text('last_operation_id').notNull(),
    digest: text('digest').notNull(),
  },
  (table) => [
    uniqueIndex('vaults_vault_id_unique').on(table.vaultId),
    check(
      'vaults_revision_bounds',
      sql`${table.revision} >= 1 AND ${table.revision} <= 2147483647`,
    ),
    check('vaults_envelope_size', sql`length(${table.envelope}) <= 1048576`),
  ],
);
export const mutationLimits = sqliteTable(
  'mutation_limits',
  {
    ownerId: text('owner_id').primaryKey().notNull(),
    window: integer('window').notNull(),
    count: integer('count').notNull(),
  },
  (table) => [
    check('mutation_window_bounds', sql`${table.window} >= 0`),
    check('mutation_count_bounds', sql`${table.count} >= 1 AND ${table.count} <= 31`),
  ],
);

// Separate, explicitly published plaintext copies. No private-vault import.
export const sharedNotes = sqliteTable(
  'shared_notes',
  {
    ownerId: text('owner_id').notNull(),
    noteId: text('note_id').notNull(),
    revision: integer('revision').notNull(),
    state: text('state').notNull(),
    title: text('title'),
    body: text('body'),
    lastOperationId: text('last_operation_id').notNull(),
    lastOperationHash: text('last_operation_hash').notNull(),
    lastOperationKind: text('last_operation_kind').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('shared_notes_owner_note').on(table.ownerId, table.noteId),
    check(
      'shared_revision',
      sql`typeof(${table.revision}) = 'integer' AND ${table.revision} BETWEEN 1 AND 2147483647`,
    ),
    check(
      'shared_state',
      sql`(${table.state} = 'shared' AND ${table.revision} <= 2147483646 AND ${table.title} IS NOT NULL AND ${table.body} IS NOT NULL AND length(${table.title}) BETWEEN 1 AND 120 AND instr(${table.title},char(0)) = 0 AND length(trim(${table.title})) > 0 AND length(CAST(${table.title} AS BLOB)) <= 480 AND length(CAST(${table.body} AS BLOB)) <= 8192 AND ${table.lastOperationKind} = 'publish') OR (${table.state} = 'revoked' AND ${table.title} IS NULL AND ${table.body} IS NULL AND ${table.lastOperationKind} = 'revoke')`,
    ),
    check(
      'shared_receipt',
      sql`length(${table.lastOperationId}) = 36 AND length(${table.lastOperationHash}) = 64 AND ${table.lastOperationHash} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check(
      'shared_ids',
      sql`length(${table.ownerId}) BETWEEN 1 AND 256 AND length(${table.noteId}) = 36`,
    ),
    check(
      'shared_time',
      sql`typeof(${table.createdAt}) = 'integer' AND typeof(${table.updatedAt}) = 'integer' AND ${table.createdAt} >= 0 AND ${table.updatedAt} >= ${table.createdAt} AND ${table.updatedAt} <= 9007199254740991`,
    ),
  ],
);
export const sharedNoteLimits = sqliteTable(
  'shared_note_limits',
  {
    ownerId: text('owner_id').primaryKey().notNull(),
    window: integer('window').notNull(),
    count: integer('count').notNull(),
  },
  (table) => [
    check('shared_limit_window', sql`typeof(${table.window}) = 'integer' AND ${table.window} >= 0`),
    check(
      'shared_limit_count',
      sql`typeof(${table.count}) = 'integer' AND ${table.count} BETWEEN 1 AND 31`,
    ),
  ],
);
