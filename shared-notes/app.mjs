import { createApi } from './transport.mjs';
import { SharedSession, reviewText } from './session.mjs';
const byId = (id) => document.getElementById(id);
const elements = Object.fromEntries(
  [
    'clear',
    'status',
    'refresh',
    'new',
    'notes',
    'empty',
    'list-panel',
    'list-heading',
    'editor-panel',
    'draft-heading',
    'back',
    'draft-empty',
    'editor',
    'title',
    'body',
    'counts',
    'revision',
    'publish',
    'revoke',
    'revoke-area',
    'pending',
    'pending-heading',
    'check',
    'retry',
    'forget',
    'review',
    'review-heading',
    'review-warning',
    'exact',
    'cancel',
    'confirm',
  ].map((id) => [id, byId(id)]),
);
const session = new SharedSession(createApi());
const messages = {
  REQUEST_TIMEOUT: 'The request timed out. A write may still have completed; check its status.',
  INVALID_ARGUMENTS: 'Check the title and note limits. Your draft has not been truncated.',
  REVIEW_EXPIRED: 'The review expired. Review the exact operation again.',
  REQUEST_IN_PROGRESS: 'Wait for the current operation.',
  OUTCOME_PENDING: 'Resolve or discard tracking of the previous operation first.',
  RETRY_PAYLOAD_CLEARED: 'The exact retry text was cleared. Check the status instead.',
  NOT_AUTHORIZED: 'Your signed-in owner session is not authorized. Reload and check sign-in.',
  UNAVAILABLE: 'That revision is no longer available. Refresh the list.',
  CONFLICT: 'The copy changed or was revoked. Check its status, then refresh.',
  OPERATION_ID_REUSED: 'The operation cannot be reused with different data.',
  CAPACITY:
    'Shared Notes capacity reached. Revoking frees active capacity, but historical IDs remain reserved.',
  RATE_LIMIT: 'Too many publication attempts. Wait a minute, then retry the exact operation.',
  STORAGE_UNAVAILABLE: 'Storage is unavailable. A write may still have completed.',
};
let error = '',
  draftWasEdited = false,
  reviewOpener = null,
  uiEpoch = 0;
function render() {
  const v = session.view(),
    d = v.draft,
    editing = !!d || !!v.pending;
  elements.status.textContent =
    error || v.message || 'Load your published notes, or create a new one. Drafts are not saved.';
  elements.status.classList.toggle('error', !!error);
  elements['list-panel'].hidden = editing;
  elements['editor-panel'].hidden = !editing;
  elements.back.hidden = !!v.pending;
  elements.back.disabled = v.busy;
  elements.editor.hidden = !d || !!v.pending;
  elements['draft-empty'].hidden = !!d || !!v.pending;
  for (const field of ['title', 'body']) {
    if (elements[field].value !== (d?.[field] ?? '')) elements[field].value = d?.[field] ?? '';
    elements[field].disabled = v.busy || !!v.pending;
  }
  if (d) {
    const points = [...d.title].length,
      bytes = new TextEncoder().encode(d.body).length;
    elements.counts.textContent = `Title: ${points} / 120 characters. Note size: ${bytes.toLocaleString()} / 8,192 bytes. Emoji and some characters use several bytes.`;
    elements.counts.classList.toggle('error', points > 120 || bytes > 8192);
    elements.revision.textContent = d.revision
      ? `Editing shared version ${d.revision} · changes are not published`
      : 'Draft · not saved or shared';
  }
  elements.notes.replaceChildren();
  for (const note of v.notes) {
    const li = document.createElement('li'),
      button = document.createElement('button');
    button.type = 'button';
    button.className = 'note-row';
    button.textContent = `${note.title} · version ${note.revision}`;
    button.disabled = v.busy || !!v.pending;
    button.addEventListener('click', () =>
      run(() => {
        draftWasEdited = false;
        return session.open({ note_id: note.note_id, revision: note.revision });
      }, 'draft-heading'),
    );
    li.append(button);
    elements.notes.append(li);
  }
  elements.empty.hidden = v.notes.length > 0;
  elements.empty.textContent = v.loaded
    ? 'No published notes. Create one when you’re ready to share.'
    : 'Shared notes haven’t been loaded yet.';
  elements.refresh.textContent = v.loaded ? 'Refresh' : 'Load shared notes';
  elements.pending.hidden = !v.pending;
  elements['pending-heading'].textContent =
    v.pending?.action === 'revoke'
      ? 'Revocation result not confirmed'
      : 'Publish result not confirmed';
  elements.check.textContent =
    v.pending?.action === 'revoke' ? 'Check revocation status' : 'Check publish status';
  elements.retry.disabled = v.busy || !v.pending?.canRetry;
  elements.check.disabled = v.busy;
  elements.forget.disabled = v.busy;
  elements.refresh.disabled = v.busy;
  elements.new.disabled = v.busy || !!v.pending;
  elements.publish.disabled = v.busy || !!v.pending || !d;
  elements.revoke.disabled = v.busy || !!v.pending || !d?.revision;
  elements['revoke-area'].hidden = !d?.revision;
  if (!v.review) {
    if (elements.review.open) elements.review.close();
    elements.exact.textContent = '';
    elements['review-warning'].textContent = '';
    elements['review-heading'].textContent = 'Review exact operation';
    elements.confirm.textContent = 'Confirm';
  }
}
async function run(action, focusAfter) {
  const epoch = uiEpoch;
  error = '';
  try {
    const promise = action();
    render();
    await promise;
  } catch (e) {
    error =
      messages[e.message] ??
      'The request could not be confirmed. If it was a write, check its status before assuming failure.';
  }
  render();
  if (epoch !== uiEpoch || document.hidden) return;
  const v = session.view();
  if (v.pending && focusAfter) {
    elements['pending-heading'].focus();
    return;
  }
  if (error) {
    elements.status.focus();
    return;
  }
  if (focusAfter) {
    if ((focusAfter === 'title' || focusAfter === 'draft-heading') && v.draft && !v.pending)
      elements[focusAfter].focus();
    else if (focusAfter === 'list-heading' && !v.draft && !v.pending) elements[focusAfter].focus();
  }
}
function showReview(action) {
  return run(() => {
    const r = action();
    reviewOpener = r.action === 'publish' ? 'publish' : 'revoke';
    elements['review-heading'].textContent =
      r.action === 'publish' ? 'Review before publishing' : 'Stop future access to this version?';
    elements['review-warning'].textContent =
      r.action === 'publish'
        ? 'This exact copy will be stored as plaintext, not encrypted like your private vault. The service and agents using your authorized account connection can read it, including non-dot sessions. It stays readable while your private vault is locked. Do not include passwords, recovery keys or other secrets.'
        : 'Confirming revokes this exact published revision for future reads. It cannot recall existing copies, service backups or reads selected before revocation.';
    elements.exact.textContent = reviewText({
      action: r.action,
      destination: location.origin,
      args: r.args,
    });
    elements.confirm.textContent =
      r.action === 'publish' ? 'Publish this exact copy' : 'Revoke this exact revision';
    elements.review.showModal();
    elements['review-heading'].focus();
  });
}
elements.new.addEventListener('click', () => {
  uiEpoch++;
  return run(() => {
    session.newNote();
    draftWasEdited = false;
  }, 'title');
});
elements.refresh.addEventListener('click', () => run(() => session.refresh()));
elements.back.addEventListener('click', () =>
  run(async () => {
    if (
      draftWasEdited &&
      !confirm(
        'Discard this unpublished draft and return to Shared Notes? Published copies are unchanged.',
      )
    )
      return;
    session.clear();
    draftWasEdited = false;
    await session.refresh();
  }, 'list-heading'),
);
for (const field of ['title', 'body'])
  elements[field].addEventListener('input', () =>
    run(() => {
      session.edit(field, elements[field].value);
      draftWasEdited = true;
    }),
  );
elements.publish.addEventListener('click', () => showReview(() => session.reviewPublish()));
elements.revoke.addEventListener('click', () => showReview(() => session.reviewRevoke()));
async function cancelReview() {
  await run(() => session.cancelReview());
  if (!document.hidden && session.view().draft && reviewOpener) elements[reviewOpener].focus();
}
elements.cancel.addEventListener('click', cancelReview);
elements.review.addEventListener('cancel', (e) => {
  e.preventDefault?.();
  return cancelReview();
});
elements.confirm.addEventListener('click', () => run(() => session.confirm(), 'list-heading'));
elements.check.addEventListener('click', () => run(() => session.checkOutcome(), 'list-heading'));
elements.retry.addEventListener('click', () => run(() => session.retry(), 'list-heading'));
elements.forget.addEventListener('click', () => run(() => session.forgetPending(), 'list-heading'));
function conceal() {
  uiEpoch++;
  error = '';
  draftWasEdited = false;
  reviewOpener = null;
  session.clear();
  render();
}
elements.clear.addEventListener('click', () => {
  conceal();
  elements[session.view().pending ? 'pending-heading' : 'list-heading'].focus();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) conceal();
});
window.addEventListener('pagehide', conceal);
window.addEventListener('pageshow', (event) => {
  if (event.persisted) conceal();
});
let timer;
function activity() {
  clearTimeout(timer);
  timer = setTimeout(conceal, 120000);
}
for (const name of ['pointerdown', 'keydown', 'input'])
  document.addEventListener(name, activity, { passive: true });
activity();
render();
