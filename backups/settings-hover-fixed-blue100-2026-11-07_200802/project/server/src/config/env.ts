import { z } from 'zod';

/** Compose passes unset vars as empty strings — treat '' as absent. */
const optionalString = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().optional(),
);

/**
 * The vault master key list, "<keyId>:<64 hex>" entries comma-separated —
 * mirrors credential-crypto.parseVaultKeys. Checked at boot so a wrong value
 * (a NEMO client secret pasted here, say) fails loudly with the variable's
 * name, instead of a 500 the first time the Organization tab asks the vault.
 */
const VAULT_KEYS_RE =
  /^[a-z0-9][a-z0-9_-]{0,31}:[0-9a-f]{64}(,[a-z0-9][a-z0-9_-]{0,31}:[0-9a-f]{64})*$/;

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z
    .string()
    .min(1)
    .regex(/^postgres(ql)?:\/\//, 'DATABASE_URL must be a postgres:// URL'),

  // Migrations at boot (spec 0058). Off is an escape hatch for repairing a
  // database by hand, not a mode to deploy in.
  RUN_MIGRATIONS_ON_BOOT: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.enum(['true', 'false']).default('true'),
  ),
  // The owner role applies DDL; the app role will not, once the Phase-4 role
  // split lands (docs/10). Unset = use DATABASE_URL.
  MIGRATION_DATABASE_URL: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z
      .string()
      .regex(/^postgres(ql)?:\/\//, 'MIGRATION_DATABASE_URL must be a postgres:// URL')
      .optional(),
  ),
  MIGRATIONS_DIR: optionalString,

  // AWS / SES (all optional: absent = notify disabled, webhook answers 503).
  // Gate is SES-only — deliberately not coupled to any S3 setting
  // (docs/runbooks/AWS_SETUP_WALKTHROUGH.md, Phase 7 gotcha).
  AWS_REGION: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().default('eu-west-1'),
  ),
  AWS_ACCESS_KEY_ID: optionalString,
  AWS_SECRET_ACCESS_KEY: optionalString,
  AWS_SES_FROM_EMAIL: optionalString,
  AWS_SES_REPLY_TO_EMAIL: optionalString,
  AWS_SES_CONFIGURATION_SET: optionalString,
  AWS_SES_EVENTS_TOPIC_ARN: optionalString,
  // The files bucket (spec 0084; runbook: nauticai-nemolink-files). Unset =
  // uploaded certificate files are kept in the database row.
  FILES_BUCKET: optionalString,

  // NEMO client: UI/UX study copy, local mock only (see nemo-client.service).
  NEMO_TARGET: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.enum(['mock']).default('mock'),
  ),
  NEMO_MOCK_URL: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().url().default('http://127.0.0.1:4010'),
  ),
  // Credential vault master keys (docs/specs/0059): "v1:<64 hex>[,v0:<64 hex>]",
  // first encrypts and all decrypt. Customer NEMO keys live in
  // platform.nemo_credential, entered by their own admin — nauticAi holds no
  // NEMO key of its own, so there is nothing to configure per deployment beyond
  // this. Absent = the vault is unavailable; mock needs none. Malformed = the
  // boot fails, naming the variable and never the value.
  NEMO_VAULT_KEYS: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z
      .string()
      .refine(
        (raw) => raw.trim() === '' || VAULT_KEYS_RE.test(raw.trim()),
        'NEMO_VAULT_KEYS entries must be "<keyId>:<64 hex chars>" — the vault master key ' +
          '(openssl rand -hex 32), comma-separated, newest first; never a NEMO client secret, ' +
          'which an org admin enters on the Organization tab',
      )
      .optional(),
  ),
  // The hazmat sync is platform-level but NEMO still wants a credential, so it
  // borrows one org's (spec 0059 §5). Named explicitly; absent on a non-mock
  // target = the job reports "not configured" and is skipped, never guessed.
  NEMO_REFDATA_ORG_SLUG: optionalString,

  // Locations come from the hub's published full dataset (docs/specs/0027) —
  // a known public URL, so a default is right here. Override only if the hub
  // moves the file.
  NEMO_LOCATIONS_JSON_URL: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z
      .string()
      .url()
      .default('https://fintraffic-vts.github.io/mnsw/location/locations.json'),
  ),
  // Hazmat service (docs/specs/0021). On stg/prd nemo-client derives it from
  // the target's host (/hazmat-service/api/v1 — one production service,
  // confirmed live 2026-09-24, spec 0062 F10); NEMO_HAZMAT_URL only overrides
  // that. On the mock target the _MOCK_URL var must be set explicitly (dev:
  // http://127.0.0.1:4012 — tools/nemo-mock). Deliberately no mock default: a
  // host running target=mock without local mocks must show "waiting for
  // configuration", not a failed run every cycle.
  NEMO_HAZMAT_URL: optionalString,
  NEMO_HAZMAT_MOCK_URL: optionalString,
  // Digitraffic's port call visits feed (docs/specs/0068): public, no key.
  // The base is a known URL, so a default is right; DIGITRAFFIC_USER is the
  // app name the service asks callers to send (Digitraffic-User header).
  DIGITRAFFIC_URL: optionalString,
  DIGITRAFFIC_USER: optionalString,

  // Vendor root for the offline refdata seeds: national-spreadsheet codelists
  // + nemo/hub data (hs-map). Default fits dev (cwd = server/); compose
  // bind-mounts the whole vendor/ tree read-only.
  REFDATA_DIR: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().default('../vendor'),
  ),
  // The hourly NEMO alive check (spec 0082)
  NEMO_ALIVE_INTERVAL_MINUTES: z.coerce.number().int().positive().default(60),
  // The visit watch (spec 0097): our visits someone cancelled in NEMO; 0 = off
  NEMO_VISIT_WATCH_MINUTES: z.coerce.number().int().min(0).default(60),
  // Schema-drift alerts (docs/specs/0024) land here; absent = log only
  ADMIN_ALERT_EMAIL: optionalString,
  REFDATA_SYNC_ON_BOOT: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.enum(['true', 'false']).default('true'),
  ),

  // Steel-thread API access (docs/specs/0008). Absent = api-key routes 503.
  NEMOLINK_API_KEY: optionalString,

  // Tenant provisioning reads THE schema at provisioning time (docs/specs/0010).
  // Default ../schema.sql fits the repo layout in dev; compose mounts the file.
  SCHEMA_SQL_PATH: optionalString,

  // Entra OIDC (docs/specs/0011 + runbooks/ENTRA_SETUP_WALKTHROUGH.md).
  // All three or nothing: absent = SSO routes 503, local login unaffected.
  ENTRA_TENANT_ID: optionalString,
  ENTRA_CLIENT_ID: optionalString,
  ENTRA_CLIENT_SECRET: optionalString,
  // Browser-facing base for the OIDC callback; dev uses http://localhost:9000
  PUBLIC_BASE_URL: optionalString,
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    // Fail fast and readable — but never echo values, only key names
    throw new Error(`Invalid environment: ${issues}`);
  }
  return result.data;
}
