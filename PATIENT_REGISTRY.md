# Patient registry and history — Phase 2

## Implemented workflows

- Public registration atomically creates a patient account and a separate Patient record. The server issues `NIT-` plus 24 random hexadecimal characters; clients cannot choose or modify it.
- Login remains email/password. The frontend mounts `/register`, `/login`, `/dashboard`, and `/dashboard/history`. The last two require a patient session and use private APIs to fetch data after reload.
- Existing patient-role accounts receive a linked Patient record on their first authenticated profile access. Concurrent requests converge on the same record; no bulk backfill or inference from report text occurs.
- Staff can register patients without an email or login account, search the authorized centre's registry, and record baseline/history entries. Matching a name or email never links an account automatically. Potential duplicates in the same centre require explicit review/confirmation before a separate record is created.
- Patients can enter diagnoses, previous treatment, allergies, medication history, baseline report summaries, and other notes. Self-entered data is labelled `patient-reported`; staff-entered data is `staff-recorded`, which is not an automatic clinical-verification claim.
- History corrections append a new entry referencing the original. No overwrite/delete history API exists. Retrying unchanged content with the same request ID is idempotent; reusing the ID for different content returns 409.
- Patients see their own history across centres. Staff require both a current centre capability and an active patient assignment; they see that centre's staff notes plus the patient's self-reported history. Platform-admin status alone never bypasses these checks.

Individual nutrition/booster/supplement plans and signed version history are now available; see `TREATMENT_PLANS.md`.

This increment stores report **summaries**, not original medical files. Private document upload, encounter management, verified account linking/merging, invitations, guardians, and the centre-transfer UI remain separate planned workflows. No research/publication consent is inferred from registration.

## Deployment requirements

Use MongoDB Atlas or a replica set/sharded deployment supporting multi-document transactions. Standalone MongoDB is insufficient: registration deliberately fails rather than falling back to non-atomic account/record creation. Tests use a disposable single-node replica set.

Before enabling registration, ensure indexes exist: unique `Patient.patientCode`; unique partial `Patient.user` for ObjectId-linked accounts; unique assignment `(patient, centre)`; unique history `(patient, authoredBy, clientRequestId)`; history timeline indexes. Model initialization awaits these indexes in the normal auto-index configuration. Deployments disabling automatic indexing must create the schema indexes through their reviewed migration process first. Do not run a destructive `syncIndexes` against existing production data.

Deploy the API before the updated public/admin frontends. Validate with synthetic staging accounts and centre grants. No production migration, grants or deployment are performed by the code change itself.

Public pages link to Patient login/My dashboard. The tab's bearer token is held in session storage (with an in-memory fallback), while names, contact details and history are fetched from the API and never written to browser storage. Startup migrates an older local-storage token once and removes old stored account metadata. Logout requests global token revocation and clears local state; offline server revocation remains subject to successful connectivity/token expiry. HttpOnly sessions and MFA remain separate Phase 1 hardening follow-ups.

Private responses use `Cache-Control: private, no-store`; dashboard pages set `noindex, nofollow`. Access logs for `/api/patient` and `/api/clinical` omit paths and query strings so patient search values do not enter ordinary logs. Do not enable clinical payload logging in proxies/APM.

## Trusted centre provisioning

An operator with database maintenance access can explicitly grant an **existing admin account** registry/history permissions:

```sh
npm run patients:setup-access -- --centre-code DEMO --centre-name "Demo Centre" --staff-email operator@example.test
```

The command creates the named centre if missing, preserves the name of an existing centre, and grants `registry.read`, `registry.write`, `history.read`, `history.write`. It never promotes a public account to admin. Use the existing trusted `admin:grant` process separately if the intended staff account has not been provisioned.

To assign an already registered patient explicitly, add their exact Patient ID:

```sh
npm run patients:setup-access -- --centre-code DEMO --centre-name "Demo Centre" --staff-email operator@example.test --patient-code NIT-0123456789ABCDEF01234567
```

Verify identity, care purpose and authorization before this grant. This adds an explicit centre assignment; it is not an account-link or patient merge and does not change the Patient ID. The command refuses inactive centres. No centre is auto-selected or assigned to self-registered patients.

## API contracts

All paths below are relative to `/api` and require the bearer token, except account registration/login. Patient identity for self-service derives exclusively from the authenticated user, never a body/query patient ID.

| Method / path | Behavior |
|---|---|
| `POST /auth/register` | `name`, `email`, `password`, optional `phone`, `dateOfBirth`, `sex`; returns account/token plus `patientCode`. |
| `GET /patient/profile` | Compatible account fields plus `patient: { _id, patientCode, name, phone, email, dateOfBirth, sex, createdAt }`. Patient accounts only. |
| `GET /patient/history?page=1&limit=20` | Own history, newest creation first. Limit at most 50. |
| `POST /patient/history` | Append self-reported history. |
| `GET /clinical/centres` | Active own memberships with `registry.read`; returns authorized centre names/codes and capabilities. |
| `GET /clinical/centres/:centreId/patients` | Paginated assigned registry; optional bounded `q` searches Patient ID, name or phone. Requires `registry.read`. |
| `POST /clinical/centres/:centreId/patients` | Register without creating a login; requires `registry.write`. A 409 duplicate warning returns centre-scoped candidates; explicit `confirmSeparatePatient: true` creates a distinct record. |
| `GET /clinical/centres/:centreId/patients/:patientId` | Assigned record, requires `registry.read`. |
| `GET /clinical/centres/:centreId/patients/:patientId/history` | Authorized centre notes plus patient-reported history; requires `history.read`. |
| `POST /clinical/centres/:centreId/patients/:patientId/history` | Append centre-authored history; requires `history.write`. |

History payload:

```json
{
  "type": "baseline",
  "title": "Initial report summary",
  "details": "Patient-reported or care-team-recorded information",
  "occurredOn": "2026-10-23",
  "clientRequestId": "a-client-generated-unique-request-id",
  "amends": null
}
```

Types: `diagnosis`, `previous-treatment`, `allergy`, `medication`, `baseline`, `other`. Dates are validated date-only ISO values; unknown dates remain null and future/invalid dates are rejected. DOB is optional; sex defaults to unknown. History text is plain text, not rich HTML. Corrections reference an existing entry in the same accessible context. A patient cannot amend a staff-authored entry.

History and staff-registration mutations retain the Phase 1 audit-intent events, which exclude payloads. These events are not a complete medical-record audit lifecycle or success receipts. Clinical read/download audit retention is still future work.

## Verification

Run backend `npm run lint`, `npm test`, `npm run type-check`, `npm run build`. `npm run test:patients` targets patient workflows. Backend type-check remains scoped to ebooks; new JavaScript is covered by lint, import/build checks and integration tests.

Frontend checks: each app's `npm run lint`, `npm test`, `npm run type-check`, `npm run build`. Public frontend type-check is also ebook-scoped. Patient tests cover concurrent IDs, forced collisions, failed-transaction rollback, input validation, legacy accounts, centre isolation, duplicate review, append/retry/amend semantics, registration/login routing, private dashboard reloads, history forms, logout and expiry.

## Google sign-in

The public login and registration pages offer **Continue with Google** using the
Firebase project `nitauth`. Enable Google under Firebase Console → Authentication
→ Sign-in method, select the support email, and add the frontend hosting domains
(including `localhost` for local testing) under Authentication → Settings →
Authorized domains. Deploy the backend `/api/auth/google` endpoint before the UI.

The backend verifies Firebase ID-token signatures, expiry, issuer and audience
with the Admin SDK, requires a verified email and Google sign-in provider, and
issues the existing revocable NIT session token. `FIREBASE_PROJECT_ID` defaults to
`nitauth`; it must match the frontend project. Public-key token verification uses
Google certificate endpoints and requires outbound HTTPS; no service-account key
is included in the frontend or repository. Firebase emulator tokens must not be
enabled in production.

First sign-in atomically creates a patient account and Patient ID. A matching
existing email requires the existing NIT password before linking; staff accounts
cannot be linked through this endpoint. Google-only accounts have no NIT password
and cannot use password login. No clinical records are merged by email. Firebase
client state stays in memory and is cleared after obtaining the ID token. The NIT
session remains in tab session storage. Analytics is not initialized by this flow.

Automated Google auth tests mock only the Firebase verification/provider boundary;
real popup completion requires Google enabled, an authorized domain, and a user
Google account. Signed tokens, patient records, linking, and logout are exercised
against disposable MongoDB in `tests/googleAuth.integration.test.mjs`.
