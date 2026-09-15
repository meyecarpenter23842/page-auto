import type Database from 'better-sqlite3'

export const SCANNER_SCHEMA_VERSION = 26
export const SCANNER_MIGRATION_NAME = 'scanner_foundation'

function applySourceCredentialHardening(client: Database.Database): void {
  client.exec(`
    CREATE TABLE IF NOT EXISTS scanner_token_credentials (
      id TEXT PRIMARY KEY NOT NULL,
      credential_type TEXT NOT NULL DEFAULT 'access_token',
      label TEXT NOT NULL,
      encrypted_secret BLOB NOT NULL,
      token_last4 TEXT NOT NULL,
      token_fingerprint TEXT NOT NULL UNIQUE,
      validation_state TEXT NOT NULL DEFAULT 'unverified',
      validation_message TEXT,
      subject_id TEXT,
      subject_name TEXT,
      validated_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_scanner_token_credentials_updated
      ON scanner_token_credentials(updated_at DESC, id);
  `)
}

export function applyScannerMigration(client: Database.Database): void {
  const migrate = client.transaction(() => {
    const applied = client
      .prepare('SELECT 1 FROM __page_auto_migrations WHERE version = ?')
      .get(SCANNER_SCHEMA_VERSION)

    if (!applied) {
      client.exec(`
        CREATE TABLE IF NOT EXISTS scan_jobs (
          id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
          scan_type TEXT NOT NULL,
          source_type TEXT NOT NULL,
          source_account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
          source_credential_ref TEXT,
          query TEXT NOT NULL DEFAULT '',
          filters_json TEXT NOT NULL DEFAULT '{}',
          limit_count INTEGER NOT NULL DEFAULT 100,
          status TEXT NOT NULL,
          result_count INTEGER NOT NULL DEFAULT 0,
          accepted_count INTEGER NOT NULL DEFAULT 0,
          message TEXT,
          started_at INTEGER,
          finished_at INTEGER,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_scan_jobs_status_updated
          ON scan_jobs(status, updated_at DESC, id DESC);
        CREATE INDEX IF NOT EXISTS idx_scan_jobs_type_created
          ON scan_jobs(scan_type, created_at DESC, id DESC);

        CREATE TABLE IF NOT EXISTS scan_job_results (
          id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
          job_id INTEGER NOT NULL REFERENCES scan_jobs(id) ON DELETE CASCADE,
          entity_id TEXT NOT NULL,
          display_name TEXT NOT NULL,
          url TEXT,
          result_status TEXT NOT NULL,
          data_json TEXT NOT NULL DEFAULT '{}',
          scanned_at INTEGER NOT NULL,
          UNIQUE(job_id, entity_id)
        );

        CREATE INDEX IF NOT EXISTS idx_scan_job_results_job
          ON scan_job_results(job_id, id);

        CREATE TABLE IF NOT EXISTS scan_datasets (
          id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
          dataset_type TEXT NOT NULL,
          name TEXT NOT NULL,
          source_job_id INTEGER REFERENCES scan_jobs(id) ON DELETE SET NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_scan_datasets_type_updated
          ON scan_datasets(dataset_type, updated_at DESC, id DESC);

        CREATE TABLE IF NOT EXISTS scan_dataset_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
          dataset_id INTEGER NOT NULL REFERENCES scan_datasets(id) ON DELETE CASCADE,
          entity_id TEXT NOT NULL,
          display_name TEXT NOT NULL,
          url TEXT,
          data_json TEXT NOT NULL DEFAULT '{}',
          source_job_id INTEGER REFERENCES scan_jobs(id) ON DELETE SET NULL,
          created_at INTEGER NOT NULL,
          UNIQUE(dataset_id, entity_id)
        );

        CREATE INDEX IF NOT EXISTS idx_scan_dataset_items_dataset
          ON scan_dataset_items(dataset_id, id);
      `)

      client.prepare(
        'INSERT INTO __page_auto_migrations (version, name, applied_at) VALUES (?, ?, ?)'
      ).run(SCANNER_SCHEMA_VERSION, SCANNER_MIGRATION_NAME, Date.now())
    }

    applySourceCredentialHardening(client)
  })

  migrate()
}
