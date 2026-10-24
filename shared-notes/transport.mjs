// A timeout cancels local waiting, not a server mutation. Session recovery keeps
// the result unknown and permits only the same previously approved retry.
export function createApi(fetcher = fetch, timeoutMs = 15000) {
  async function request(action, args) {
    const controller = new AbortController();
    let reader, timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reader?.cancel().catch(() => {});
        reject(Error('REQUEST_TIMEOUT'));
      }, timeoutMs);
    });
    const work = async () => {
      const response = await fetcher('/shared-notes/api', {
        method: 'POST',
        credentials: 'same-origin',
        redirect: 'error',
        cache: 'no-store',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: action, params: args }),
      });
      if (controller.signal.aborted) throw Error('REQUEST_TIMEOUT');
      if (!response.body) throw Error('INVALID_RESPONSE');
      reader = response.body.getReader();
      const chunks = [];
      let length = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > 65536) {
            void reader.cancel().catch(() => {});
            throw Error('INVALID_RESPONSE');
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      if (controller.signal.aborted) throw Error('REQUEST_TIMEOUT');
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (!response.ok) throw Error(body.code ?? 'REQUEST_FAILED');
      if (!body || !Object.hasOwn(body, 'result')) throw Error('INVALID_RESPONSE');
      return body.result;
    };
    try {
      return await Promise.race([work(), deadline]);
    } finally {
      clearTimeout(timer);
    }
  }
  return Object.fromEntries(
    ['list', 'read', 'publish', 'revoke', 'status'].map((action) => [
      action,
      (args) => request(action, args),
    ]),
  );
}
