export interface Env {
  DB: D1Database;
  ARCHIVE: R2Bucket;
  STATIONS: DurableObjectNamespace;
  APP_ENV: string;
  API_READ_LIMIT?: RateLimit;
  API_WRITE_LIMIT?: RateLimit;
  INGEST_TOKEN?: string;
  ADMIN_TOKEN?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  ASSETS: Fetcher;
}
