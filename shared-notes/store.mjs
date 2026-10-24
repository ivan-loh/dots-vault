import { MAX_ACTIVE, MAX_TOTAL, fail, operationHash, ownerId, validate } from './model.mjs';

const RECEIPT = `SELECT revision,state,last_operation_id,last_operation_hash,last_operation_kind
  FROM shared_notes WHERE owner_id=? AND note_id=?`;

// All mutations are single conditional SQL statements. A receipt pre-read is an
// optimization only: CAS and latest-operation reuse checks also live in SQL.
export class SharedStore {
  constructor(db, now = Date.now) {
    this.db = db;
    this.now = now;
  }
  query(sql, ...args) {
    return this.db.prepare(sql).bind(...args);
  }
  receipt(owner, id) {
    return this.query(RECEIPT, owner, id).first();
  }
  replay(row, args, hash, kind) {
    if (!row || row.last_operation_id !== args.operation_id) return null;
    if (row.last_operation_hash !== hash || row.last_operation_kind !== kind)
      fail('OPERATION_ID_REUSED');
    return { note_id: args.note_id, revision: row.revision, state: row.state };
  }
  timestamp() {
    const now = this.now();
    if (!Number.isSafeInteger(now) || now < 0) fail('STORAGE_UNAVAILABLE');
    return now;
  }
  async admit(owner, now) {
    const row = await this.query(
      `INSERT INTO shared_note_limits(owner_id,window,count) VALUES(?,?,1)
      ON CONFLICT(owner_id) DO UPDATE SET
      count=CASE WHEN excluded.window>shared_note_limits.window THEN 1 ELSE MIN(shared_note_limits.count+1,31) END,
      window=MAX(shared_note_limits.window,excluded.window) RETURNING count`,
      owner,
      Math.floor(now / 60000),
    ).first();
    if (!row || !Number.isInteger(row.count) || row.count < 1) fail('STORAGE_UNAVAILABLE');
    if (row.count > 30) fail('RATE_LIMIT');
  }
  async list(owner) {
    ownerId(owner);
    const result = await this.query(
      `SELECT note_id,revision,title FROM shared_notes
      WHERE owner_id=? AND state='shared' ORDER BY updated_at DESC,note_id LIMIT ?`,
      owner,
      MAX_ACTIVE,
    ).all();
    if (result?.success !== true || !Array.isArray(result.results)) fail('STORAGE_UNAVAILABLE');
    return result.results.map((row) => {
      validate('read', { note_id: row.note_id, revision: row.revision });
      validate('publish', {
        note_id: row.note_id,
        operation_id: row.note_id,
        expected_revision: 0,
        title: row.title,
        body: '',
      });
      return { note_id: row.note_id, revision: row.revision, title: row.title };
    });
  }
  async read(owner, input) {
    ownerId(owner);
    const args = validate('read', input);
    const row = await this.query(
      `SELECT note_id,revision,title,body FROM shared_notes
      WHERE owner_id=? AND note_id=? AND revision=? AND state='shared'`,
      owner,
      args.note_id,
      args.revision,
    ).first();
    if (!row) fail('UNAVAILABLE');
    validate('publish', {
      note_id: row.note_id,
      operation_id: row.note_id,
      expected_revision: 0,
      title: row.title,
      body: row.body,
    });
    return { note_id: row.note_id, revision: row.revision, title: row.title, body: row.body };
  }
  async status(owner, input) {
    ownerId(owner);
    const args = validate('status', input);
    const row = await this.receipt(owner, args.note_id);
    if (!row) return { matched: false, current_revision: null, state: null };
    const result = {
      matched: row.last_operation_id === args.operation_id,
      current_revision: row.revision,
      state: row.state,
    };
    if (result.matched) result.kind = row.last_operation_kind;
    return result;
  }
  async publish(owner, input) {
    ownerId(owner);
    const args = validate('publish', input);
    const hash = await operationHash(owner, 'publish', args);
    const replay = this.replay(await this.receipt(owner, args.note_id), args, hash, 'publish');
    if (replay) return replay;
    const now = this.timestamp();
    await this.admit(owner, now);
    let row;
    if (args.expected_revision === 0) {
      row = await this.query(
        `INSERT INTO shared_notes
        (owner_id,note_id,revision,state,title,body,last_operation_id,last_operation_hash,last_operation_kind,created_at,updated_at)
        SELECT ?,?,1,'shared',?,?,?,?,'publish',?,?
        WHERE (SELECT COUNT(*) FROM shared_notes WHERE owner_id=?)<?
        AND (SELECT COUNT(*) FROM shared_notes WHERE owner_id=? AND state='shared')<?
        ON CONFLICT(owner_id,note_id) DO NOTHING RETURNING revision,state`,
        owner,
        args.note_id,
        args.title,
        args.body,
        args.operation_id,
        hash,
        now,
        now,
        owner,
        MAX_TOTAL,
        owner,
        MAX_ACTIVE,
      ).first();
    } else {
      row = await this.query(
        `UPDATE shared_notes SET revision=revision+1,title=?,body=?,
        last_operation_id=?,last_operation_hash=?,last_operation_kind='publish',updated_at=MAX(updated_at,?)
        WHERE owner_id=? AND note_id=? AND state='shared' AND revision=? AND last_operation_id<>?
        RETURNING revision,state`,
        args.title,
        args.body,
        args.operation_id,
        hash,
        now,
        owner,
        args.note_id,
        args.expected_revision,
        args.operation_id,
      ).first();
    }
    if (row) return { note_id: args.note_id, revision: row.revision, state: row.state };
    const current = await this.receipt(owner, args.note_id);
    const racedReplay = this.replay(current, args, hash, 'publish');
    if (racedReplay) return racedReplay;
    fail(args.expected_revision === 0 && !current ? 'CAPACITY' : 'CONFLICT');
  }
  async revoke(owner, input) {
    ownerId(owner);
    const args = validate('revoke', input);
    const hash = await operationHash(owner, 'revoke', args);
    const replay = this.replay(await this.receipt(owner, args.note_id), args, hash, 'revoke');
    if (replay) return replay;
    const row = await this.query(
      `UPDATE shared_notes SET revision=revision+1,state='revoked',title=NULL,body=NULL,
      last_operation_id=?,last_operation_hash=?,last_operation_kind='revoke',updated_at=MAX(updated_at,?)
      WHERE owner_id=? AND note_id=? AND state='shared' AND revision=? AND last_operation_id<>?
      RETURNING revision,state`,
      args.operation_id,
      hash,
      this.timestamp(),
      owner,
      args.note_id,
      args.expected_revision,
      args.operation_id,
    ).first();
    if (row) return { note_id: args.note_id, revision: row.revision, state: row.state };
    const racedReplay = this.replay(await this.receipt(owner, args.note_id), args, hash, 'revoke');
    if (racedReplay) return racedReplay;
    fail('CONFLICT');
  }
}
