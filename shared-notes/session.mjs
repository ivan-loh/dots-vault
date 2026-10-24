import { validate } from './model.mjs';
export const reviewText = (value) =>
  JSON.stringify(value).replace(
    /[^\x20-\x7e]/g,
    (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'),
  );
const fail = (code) => {
  throw new Error(code);
};
export class SharedSession {
  #api;
  #now;
  #uuid;
  #draft = null;
  #review = null;
  #pending = null;
  #notes = [];
  #loaded = false;
  #flight = null;
  #epoch = 0;
  #message = '';
  constructor(api, { now = Date.now, uuid = () => crypto.randomUUID() } = {}) {
    this.#api = api;
    this.#now = now;
    this.#uuid = uuid;
  }
  view() {
    return structuredClone({
      draft: this.#draft,
      review: this.#review,
      notes: this.#notes,
      loaded: this.#loaded,
      busy: !!this.#flight,
      message: this.#message,
      pending: this.#pending
        ? {
            action: this.#pending.action,
            note_id: this.#pending.reference.note_id,
            canRetry: !!this.#pending.args,
          }
        : null,
    });
  }
  #idle() {
    if (this.#flight) fail('REQUEST_IN_PROGRESS');
  }
  #editable() {
    this.#idle();
    if (this.#pending) fail('OUTCOME_PENDING');
  }
  newNote() {
    this.#editable();
    this.#draft = { note_id: this.#uuid(), revision: 0, title: '', body: '' };
    this.#review = null;
    this.#message = 'Local draft only. Nothing is shared until you review and publish.';
  }
  edit(field, value) {
    this.#editable();
    if (!this.#draft || !['title', 'body'].includes(field) || typeof value !== 'string')
      fail('INVALID_ARGUMENTS');
    this.#draft[field] = value;
    this.#review = null;
  }
  clear() {
    this.#epoch++;
    this.#draft = null;
    this.#review = null;
    this.#notes = [];
    this.#loaded = false;
    if (this.#pending) this.#pending = { ...this.#pending, args: null };
    // Only an in-flight mutation retains busy ownership across concealment.
    // Older list/read/status completions must never clear a newer flight.
    if (this.#flight?.kind !== 'mutation') this.#flight = null;
    this.#message = this.#pending
      ? 'Local text cleared. The prior operation may have completed; check its outcome.'
      : 'Local text cleared. Published copies remain shared until revoked.';
  }
  async #readFlight(kind, request, apply) {
    this.#idle();
    const token = { kind, epoch: this.#epoch };
    this.#flight = token;
    try {
      const result = await request();
      if (this.#flight === token && this.#epoch === token.epoch) apply(result);
      return result;
    } catch (error) {
      if (this.#flight === token && this.#epoch === token.epoch) throw error;
    } finally {
      if (this.#flight === token) this.#flight = null;
    }
  }
  refresh() {
    return this.#readFlight(
      'list',
      () => this.#api.list({}),
      (result) => {
        if (!Array.isArray(result.notes) || result.notes.length > 50) fail('INVALID_RESPONSE');
        this.#notes = result.notes.map((row) => {
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
        this.#loaded = true;
      },
    );
  }
  open(reference) {
    this.#editable();
    const args = validate('read', reference);
    return this.#readFlight(
      'read',
      () => this.#api.read(args),
      (result) => {
        if (result.note_id !== args.note_id || result.revision !== args.revision)
          fail('INVALID_RESPONSE');
        validate('publish', {
          note_id: args.note_id,
          operation_id: args.note_id,
          expected_revision: 0,
          title: result.title,
          body: result.body,
        });
        this.#draft = {
          note_id: args.note_id,
          revision: args.revision,
          title: result.title,
          body: result.body,
        };
        this.#review = null;
        this.#message =
          'Editing this local draft does not update the shared copy until publication.';
      },
    );
  }
  #prepare(action) {
    this.#editable();
    if (!this.#draft) fail('NO_DRAFT');
    const d = this.#draft;
    const args = validate(action, {
      note_id: d.note_id,
      operation_id: this.#uuid(),
      expected_revision: d.revision,
      ...(action === 'publish' ? { title: d.title, body: d.body } : {}),
    });
    this.#review = { action, args, expiresAt: this.#now() + 60000 };
    return this.view().review;
  }
  reviewPublish() {
    return this.#prepare('publish');
  }
  reviewRevoke() {
    return this.#prepare('revoke');
  }
  cancelReview() {
    this.#idle();
    this.#review = null;
  }
  confirm() {
    this.#editable();
    if (!this.#review) fail('REVIEW_REQUIRED');
    if (this.#now() > this.#review.expiresAt) {
      this.#review = null;
      fail('REVIEW_EXPIRED');
    }
    const { action, args } = this.#review;
    this.#review = null;
    this.#pending = {
      action,
      args,
      reference: { note_id: args.note_id, operation_id: args.operation_id },
      expected_revision: args.expected_revision,
    };
    return this.#mutate();
  }
  #accept(receipt, pending) {
    const state = pending.action === 'publish' ? 'shared' : 'revoked';
    if (
      receipt.note_id !== pending.reference.note_id ||
      receipt.revision !== pending.expected_revision + 1 ||
      receipt.state !== state
    )
      fail('INVALID_RESPONSE');
    this.#pending = null;
    this.#draft = null;
    this.#review = null;
    this.#notes = [];
    this.#loaded = false;
    this.#message =
      state === 'shared'
        ? 'Published. This copy is service- and connection-readable, even while your private vault is locked.'
        : 'Revoked for future reads. Existing copies and reads already selected may remain.';
  }
  async #mutate() {
    this.#idle();
    const pending = this.#pending;
    if (!pending?.args) fail('RETRY_PAYLOAD_CLEARED');
    const token = { kind: 'mutation', epoch: this.#epoch };
    this.#flight = token;
    try {
      const result = await this.#api[pending.action](pending.args);
      this.#accept(result, pending);
    } catch (error) {
      this.#message =
        'Outcome unknown. Do not assume the operation failed. Check outcome or retry the exact operation.';
      throw error;
    } finally {
      if (this.#flight === token) this.#flight = null;
    }
  }
  retry() {
    return this.#mutate();
  }
  checkOutcome() {
    this.#idle();
    const pending = this.#pending;
    if (!pending) fail('NO_PENDING_OPERATION');
    return this.#readFlight(
      'status',
      () => this.#api.status(pending.reference),
      (result) => {
        if (result.matched === true && result.kind === pending.action)
          this.#accept(
            {
              note_id: pending.reference.note_id,
              revision: result.current_revision,
              state: result.state,
            },
            pending,
          );
        else
          this.#message =
            'No matching latest receipt. The operation may still have completed or may still be in flight.';
      },
    );
  }
  forgetPending() {
    this.#idle();
    this.#pending = null;
    this.#draft = null;
    this.#review = null;
    this.#message =
      'Local tracking discarded. The operation may have completed; refresh and inspect shared copies. This does not revoke anything.';
  }
}
