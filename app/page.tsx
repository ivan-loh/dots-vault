/* eslint-disable @next/next/no-html-link-for-pages -- This script-disabled screen uses full-document links. */
import { redirect } from 'next/navigation';
import { getChatGPTUser } from './chatgpt-auth';
import { humanState } from '../lib/human-route';
export const dynamic = 'force-dynamic';
export default async function Home() {
  const state = humanState(await getChatGPTUser());
  if (state.dataEnabled && state.ownerMatches) redirect('/vault');
  return (
    <main className="entry-screen">
      <a className="wordmark" href="/">
        dots-vault
      </a>
      <section className="card">
        <h1>{state.ownerPinned ? 'Owner access required' : 'Vault unavailable'}</h1>
        <p>
          {state.ownerPinned
            ? 'Your signed-in account could not be verified as the owner. Signing in verifies access; it does not unlock encrypted data.'
            : 'The vault connection has not been configured. Data entry stays disabled.'}
        </p>
        <a className="button" href="/identity">
          Check sign-in identity
        </a>
      </section>
    </main>
  );
}
