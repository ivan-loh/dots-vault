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
    'editor',
    'title',
    'body',
    'counts',
    'revision',
    'publish',
    'detail-panel',
    'detail-heading',
    'detail-body',
    'detail-revision',
    'edit',
    'revoke',
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
  uiEpoch = 0,
  screen = 'list',
  loadingList = false,
  listFailed = false,
  pendingActivity = '';
function render() {
  const v = session.view(),
    d = v.draft,
    pending = !!v.pending,
    editing = !!d && screen === 'edit' && !pending,
    reading = !!d && screen === 'detail' && !pending;
  const pendingTitle =
    v.pending?.action === 'revoke'
      ? v.busy && pendingActivity?.kind === 'mutation'
        ? 'Stopping access…'
        : 'Revocation result not confirmed'
      : v.busy && pendingActivity?.kind === 'mutation'
        ? 'Publishing…'
        : 'Publish result not confirmed';
  const busyText = pendingActivity?.kind === 'status' ? 'Checking status…' : pendingTitle;
  elements.status.textContent =
    pending && v.busy
      ? v.message.startsWith('Local text cleared.')
        ? `${v.message} ${busyText}`
        : busyText
      : error || (pending ? v.message : d ? '' : v.message);
  elements.status.classList.toggle('error', !!error && !v.busy);
  elements['list-panel'].hidden = !!d || pending;
  elements['editor-panel'].hidden = !d && !pending;
  elements.back.hidden = pending;
  elements.back.disabled = v.busy;
  elements.editor.hidden = !editing;
  elements['draft-heading'].hidden = !editing;
  elements['detail-panel'].hidden = !reading;
  for (const field of ['title', 'body']) {
    if (elements[field].value !== (editing ? d[field] : ''))
      elements[field].value = editing ? d[field] : '';
    elements[field].disabled = v.busy || pending;
  }
  elements['detail-heading'].textContent = reading ? d.title : '';
  elements['detail-body'].textContent = reading ? d.body : '';
  elements['detail-revision'].textContent = reading ? `Published revision ${d.revision}` : '';
  if (editing) {
    const points = [...d.title].length,
      bytes = new TextEncoder().encode(d.body).length;
    elements.counts.textContent = `${points} / 120 title characters · ${bytes.toLocaleString()} / 8,192 note bytes`;
    elements.counts.hidden = points < 100 && bytes < 7000;
    elements.counts.classList.toggle('error', points > 120 || bytes > 8192);
    elements['draft-heading'].textContent = d.revision ? 'Edit shared note' : 'New shared note';
    elements.revision.textContent = d.revision
      ? `Draft of revision ${d.revision} · not published`
      : 'Draft · not saved';
  } else {
    elements.counts.textContent = '';
    elements.revision.textContent = '';
  }
  elements.notes.replaceChildren();
  for (const note of v.notes) {
    const li = document.createElement('li'),
      button = document.createElement('button');
    button.type = 'button';
    button.className = 'note-row';
    button.textContent = note.title;
    button.disabled = v.busy || pending;
    button.addEventListener('click', () =>
      run(async () => {
        const epoch = uiEpoch;
        await session.open({ note_id: note.note_id, revision: note.revision });
        if (epoch === uiEpoch && session.view().draft) {
          screen = 'detail';
          draftWasEdited = false;
        }
      }, 'detail-heading'),
    );
    li.append(button);
    elements.notes.append(li);
  }
  elements.empty.hidden = v.notes.length > 0;
  elements.empty.textContent = loadingList
    ? 'Loading shared notes…'
    : listFailed
      ? 'Could not load shared notes. Refresh to try again.'
      : v.loaded
        ? 'No shared notes yet.'
        : 'Refresh to load shared notes.';
  elements.refresh.textContent = 'Refresh';
  elements.pending.hidden = !pending;
  elements['pending-heading'].textContent = pendingTitle;
  if (!pending && !d && !document.hidden && document.activeElement === elements['pending-heading'])
    elements['list-heading'].focus();
  elements.check.textContent =
    v.pending?.action === 'revoke' ? 'Check revocation status' : 'Check publish status';
  elements.retry.disabled = v.busy || !v.pending?.canRetry;
  elements.check.disabled = v.busy;
  elements.forget.disabled = v.busy;
  elements.refresh.disabled = v.busy;
  elements.new.disabled = v.busy || pending;
  elements.publish.disabled = v.busy || pending || !editing;
  elements.revoke.disabled = v.busy || pending || !reading;
  elements.edit.disabled = v.busy || pending;
  if (!v.review) {
    if (elements.review.open) elements.review.close();
    elements.exact.textContent = '';
    elements['review-warning'].textContent = '';
    elements['review-heading'].textContent = 'Review exact operation';
    elements.confirm.textContent = 'Confirm';
  }
}
async function refreshMetadata() {
  const epoch = uiEpoch;
  loadingList = true;
  listFailed = false;
  try {
    const request = session.refresh();
    render();
    await request;
  } catch (e) {
    if (epoch === uiEpoch) listFailed = true;
    throw e;
  } finally {
    if (epoch === uiEpoch) loadingList = false;
  }
}
async function run(action, focusAfter, { refreshAfter = false, activity = '' } = {}) {
  const epoch = uiEpoch,
    activityToken = activity ? { kind: activity } : null;
  error = '';
  if (activityToken) pendingActivity = activityToken;
  try {
    const promise = action();
    render();
    if (focusAfter && session.view().pending && session.view().busy && !document.hidden)
      elements['pending-heading'].focus();
    await promise;
    if (epoch === uiEpoch && !document.hidden && refreshAfter && !session.view().pending) {
      screen = 'list';
      draftWasEdited = false;
      render();
      if (focusAfter) elements['list-heading'].focus();
      const confirmedMessage = session.view().message;
      try {
        await refreshMetadata();
      } catch {
        if (epoch === uiEpoch)
          error = `${confirmedMessage} The shared-note list could not be refreshed. Use Refresh to try again.`;
      }
    }
  } catch (e) {
    if (epoch === uiEpoch)
      error =
        messages[e.message] ??
        'The request could not be confirmed. If it was a write, check its status before assuming failure.';
  }
  if (activityToken && pendingActivity === activityToken) pendingActivity = null;
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
    if ((focusAfter === 'title' || focusAfter === 'draft-heading') && v.draft && screen === 'edit')
      elements[focusAfter].focus();
    else if (focusAfter === 'detail-heading' && v.draft && screen === 'detail')
      elements[focusAfter].focus();
    else if (focusAfter === 'list-heading' && !v.draft && !v.pending) elements[focusAfter].focus();
  }
}
function showReview(action) {
  return run(() => {
    const r = action();
    reviewOpener = r.action === 'publish' ? 'publish' : 'revoke';
    elements['review-heading'].textContent =
      r.action === 'publish' ? 'Review before publishing' : 'Stop future access to this revision?';
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
    elements.cancel.textContent = r.action === 'publish' ? 'Back to editor' : 'Back to note';
    elements.review.showModal();
    elements['review-heading'].focus();
  });
}
elements.new.addEventListener('click', () => {
  if (session.view().busy) return;
  uiEpoch++;
  return run(() => {
    session.newNote();
    screen = 'edit';
    draftWasEdited = false;
  }, 'title');
});
elements.refresh.addEventListener('click', () => run(refreshMetadata));
elements.edit.addEventListener('click', () =>
  run(() => {
    if (!session.view().draft) return;
    screen = 'edit';
    draftWasEdited = false;
  }, 'title'),
);
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
    screen = 'list';
    draftWasEdited = false;
    await refreshMetadata();
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
  const epoch = uiEpoch;
  await run(() => session.cancelReview());
  if (epoch === uiEpoch && !document.hidden && session.view().draft && reviewOpener)
    elements[reviewOpener].focus();
}
elements.cancel.addEventListener('click', cancelReview);
elements.review.addEventListener('cancel', (e) => {
  e.preventDefault?.();
  return cancelReview();
});
elements.confirm.addEventListener('click', () => {
  if (session.view().busy) return;
  return run(() => session.confirm(), 'list-heading', { refreshAfter: true, activity: 'mutation' });
});
elements.check.addEventListener('click', () =>
  run(() => session.checkOutcome(), 'list-heading', { refreshAfter: true, activity: 'status' }),
);
elements.retry.addEventListener('click', () =>
  run(() => session.retry(), 'list-heading', { refreshAfter: true, activity: 'mutation' }),
);
elements.forget.addEventListener('click', () =>
  run(() => {
    session.forgetPending();
    screen = 'list';
  }, 'list-heading'),
);
function conceal({ focus = false } = {}) {
  uiEpoch++;
  error = '';
  draftWasEdited = false;
  reviewOpener = null;
  screen = 'list';
  loadingList = false;
  listFailed = false;
  session.clear();
  render();
  if (focus && !document.hidden)
    elements[session.view().pending ? 'pending-heading' : 'list-heading'].focus();
}
elements.clear.addEventListener('click', () => conceal({ focus: true }));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) conceal();
});
window.addEventListener('pagehide', () => conceal());
window.addEventListener('pageshow', (event) => {
  if (event.persisted) conceal();
});
let timer;
function activity() {
  clearTimeout(timer);
  timer = setTimeout(() => conceal({ focus: true }), 120000);
}
for (const name of ['pointerdown', 'keydown', 'input'])
  document.addEventListener(name, activity, { passive: true });
activity();
render();
run(refreshMetadata);
