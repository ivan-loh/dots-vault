/* eslint-disable @next/next/no-html-link-for-pages -- This deliberately script-disabled readiness UI requires ordinary full-document links. */
import { getChatGPTUser, chatGPTSignInPath } from '../chatgpt-auth';
import { humanState } from '../../lib/human-route';
export const dynamic = 'force-dynamic';
export default async function Identity() {
  const user = await getChatGPTUser();
  const state = humanState(user);
  return (
    <main className="diagnostic">
      <a className="wordmark" href="/">
        dots-vault<span>●</span>
      </a>
      <p className="eyebrow">READ-ONLY HOSTING CHECK</p>
      <h1>Identity is not an unlock key.</h1>
      <p>
        This page only displays the identity reported by Sites for this request. It does not create
        an owner record, change permissions, store credentials or enable vault data.
      </p>
      {user ? (
        <section className="card">
          <h2>Signed-in identity observed</h2>
          <p className="subtle">Site-scoped subject</p>
          <code>{user.userId}</code>
          <p>
            Owner binding:{' '}
            <strong>
              {state.ownerPinned
                ? state.ownerMatches
                  ? 'matches your signed-in identity'
                  : 'configured for a different identity'
                : 'not configured'}
            </strong>
          </p>
          <p>
            Human vault routes:{' '}
            <strong>
              {state.dataEnabled ? 'enabled, storage checked when opened' : 'disabled'}
            </strong>
          </p>
          <p>
            Private vault agent access: <strong>disabled</strong>
          </p>
          <p>Published Shared Notes use a separate, read-only connection.</p>
        </section>
      ) : (
        <section className="card">
          <h2>No signed-in identity available</h2>
          <p>No data is accessible. Service access does not establish a human owner.</p>
          <a className="button" href={chatGPTSignInPath('/identity')} target="_top">
            Sign in with ChatGPT
          </a>
        </section>
      )}
      <p>
        <a href="/">Back to dots-vault</a>
      </p>
    </main>
  );
}
