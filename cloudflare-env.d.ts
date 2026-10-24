declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    VAULT_OWNER_SUBJECT?: string;
    VAULT_CANONICAL_ORIGIN?: string;
    BUCKET?: R2Bucket;
  }
}
