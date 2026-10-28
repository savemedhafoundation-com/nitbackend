# Individual treatment plans — Phase 3

## Delivered workflow

The existing condition-level `Treatment` guidance is unchanged. Individual patient plans use separate `PatientTreatmentPlan` draft records and `TreatmentPlanVersion` signed snapshots.

1. Select an assigned patient within an authorized centre in the staff **Patients** workspace.
2. Create and save a draft with nutrition guidance, boosters/supplements, dates, concurrent treatments, adverse-event notes and other instructions.
3. An explicitly authorized signer reviews the saved draft, confirms the sign-off statement and re-enters their password. Unsaved changes cannot be signed from the editor.
4. The API signs the saved database revision, records the author and signer, and publishes that version to the patient's `/dashboard/treatment-plans` view.
5. Later changes require an amendment reason and a new draft copied from the current signed version. The patient continues seeing the previous signed version until the amendment is signed. All earlier signed versions remain available.
6. Discontinuation is a signed amendment with status `discontinued` and a reason. It never overwrites the earlier plan. Nutrition/item data and adverse-event context remain in the signed history.

Each plan is independent; creating a second plan does not automatically discontinue a different plan. Dates may be historical or future; start date is required to sign, and end date cannot precede it. The patient view labels future plans Scheduled and past-end-date plans Ended. An explicit Discontinued status requires the signed amendment workflow.

The product records instructions supplied by authorized care staff. It does not generate doses, validate clinical appropriateness/interactions or turn educational/AI content into prescriptions. Staff and clinical workflow review is still required in staging before real patient use.

## Explicit permissions

All staff endpoints require active centre membership plus active patient assignment. Reading requires `treatment.read`; saving/creating/amending also requires `treatment.write`; signing additionally requires `treatment.sign`. An admin role alone grants none of these capabilities. The registry UI also needs `registry.read` to select the patient.

Existing users/grants are not automatically upgraded. A trusted operator can provision treatment editing with the Phase 2 maintenance command:

```sh
npm run patients:setup-access -- --centre-code DEMO --centre-name "Demo Centre" --staff-email operator@example.test --allow-treatment-plans
```

Only when the operator has separately authorized the person to sign, add `--allow-treatment-signing`. That flag requires `--allow-treatment-plans`. The command is additive; omitting flags does not revoke prior grants. Revoke/deactivate centre memberships explicitly when withdrawing clinical access; changing the general admin role alone does not remove capability grants.

Patients can only read signed plans linked to their authenticated Patient record. They cannot retrieve drafts, author plans, sign, or amend them. Staff cannot access another centre's plans through a patient assigned at both centres.

## Signed record integrity

Signing uses a MongoDB transaction to insert the snapshot, advance the plan's signed-version pointer, clear its draft, and append a success audit event. A failure rolls back all four. Existing Atlas/replica-set requirements from Phase 2 apply.

Signed snapshots contain normalized content, immutable-version sequence, amendment reason, captured author identity/name, signer identity/name, server signing time and method `authenticated-password-attestation`. The content hash covers those values and the previous version's hash. Reads verify this checksum before returning content.

This is authenticated application sign-off, not an external certificate or PKI digital signature. The application provides no update/delete API for signed versions and rejects normal Mongoose save/update/delete/bulk-write mutations. A privileged raw database writer can still bypass application controls or rewrite checksums; restricted DB roles, backups and operational audit remain essential. No claim of legal signature certification or tamper-proof storage is made.

Every edit/sign/amend supplies `expectedRevision`. Stale revisions and concurrent sign attempts return 409. Reload and inspect the saved plan before retrying. If a sign request times out, reload the signed history first; replaying an old signing revision cannot create another version. Initial draft creation uses a required `clientRequestId`; retrying the same content/key returns the same plan, while reusing it with different content returns 409.

Signing confirmation attempts are limited in the shared MongoDB store to five unsuccessful requests per account per 15-minute window. Successful responses are excluded. Passwords are neither saved in clinical records nor audit events. Existing private API logging omits paths, query strings and clinical payloads.

## API contracts

Staff base: `/api/clinical/centres/:centreId/patients/:patientId/treatment-plans`.

| Method / suffix | Request and response |
|---|---|
| `GET /` | Paginated centre-scoped plans including drafts and current signed versions. |
| `POST /` | `{ clientRequestId, content }`; creates an unsigned draft. |
| `PATCH /:planId/draft` | `{ expectedRevision, content }`; replaces draft content only. |
| `POST /:planId/amend` | `{ expectedRevision, reason }`; creates an amendment from a signed plan when no draft is already open. |
| `POST /:planId/sign` | `{ expectedRevision, confirmed: true, password }`; signs the saved revision. Supplied signer identity/time/content are ignored. |
| `GET /:planId/versions` | Paginated signed snapshots and current signed-version number. |

Patient endpoints: `GET /api/patient/treatment-plans` and `GET /api/patient/treatment-plans/:planId/versions`. Responses exclude draft metadata/revision and drafts do not contribute to patient counts. Page size is bounded at 50; history is pinned to the signed version read from the plan to avoid misleading results during concurrent signing.

Content fields:

- `title` (required), `nutrition` (plain text), `notes`, `concurrentTreatments`, `adverseEvents`.
- `startsOn`, `endsOn`: date-only ISO values; unknown draft dates may be null.
- `status`: `active` or `discontinued`; new plans begin active. Discontinuation needs an earlier signed version and `stopReason`.
- `items`: at most 50 entries, each with `kind` (`booster`/`supplement`), `name`, `dose`, `unit`, `route`, `frequency`, `duration`, `instructions`.

Drafts can have incomplete dose details, but signing requires every item to have dose, unit, route, frequency and duration. Signing also requires a start date and either nutrition guidance or at least one item. Text fields have server-side length bounds. No medical record content is written to browser storage.

## Rollout and verification

Deploy backend before frontends. Ensure unique indexes on `(plan, version)` and `(patient, centre, createdBy, clientRequestId)`, plus patient/centre timeline indexes. No existing generic treatments or patient histories are migrated or signed automatically.

Run `npm run test:treatment-plans` or the full backend `npm test`, plus each app's lint/build/test/configured type-check. Backend and public-app type checks remain ebook-scoped; new JavaScript is validated by lint/build and integration tests.

Tests cover draft privacy/counts, ownership/centre isolation, missing signing grants, password/review requirements, signer spoofing, incomplete instructions, idempotent creation, concurrent saves/signing, amendment/discontinuation history, mutation guards, checksum verification, transactional rollback, staff editing/signing UI, patient read-only current/history views and the connected protected dashboard route.

The maintenance grant command and production deployment are not run as part of local implementation. Encounter workflows, medical-document uploads/lab tracking, full audit retention and external signature infrastructure remain separate work.
