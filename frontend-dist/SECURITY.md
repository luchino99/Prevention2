# Uelfy Security Policy

> **Last updated**: 2026-04-26
> **Applies to**: the Uelfy Clinical platform — the web application,
> the API endpoints under `/api/v1/*`, and the database schema in
> `supabase/migrations/`.
>
> **Owner**: Uelfy security team. Contact details below.
>
> **Scope notes**: this policy covers the platform that Uelfy operates.
> Tenant-specific deployments operated under a Data Processing Agreement
> may have additional controller-side procedures recorded in the per-tenant
> DPA — those override the general policy where stricter.

---

## 1. Reporting a vulnerability

If you believe you have found a security vulnerability in Uelfy
Clinical, please report it to us privately so we can investigate and
deploy a fix before public disclosure.

**Preferred channels**:

| Channel | Use it for |
|---|---|
| Email: `security@uelfy.com` | Most reports. Encrypted email is welcome — see §6 for the public PGP key (when published). |
| GitHub Security Advisory (this repository) | If you already have a working PoC and want a tracked issue. |

**Please do NOT**:

- Open a public GitHub issue describing the vulnerability.
- Post details to social media, mailing lists, or chat channels before
  the embargo lifts (see §3).
- Run automated scanners against production tenants without prior
  authorisation (against staging at moderate intensity is fine; see §4).
- Access, modify, exfiltrate, or destroy data that is not your own
  during your testing.

## 2. What to include in a report

To accelerate triage, please provide:

1. A clear description of the vulnerability and its impact.
2. Steps to reproduce (a curl invocation, a small script, or a recorded
   walkthrough — any of these works).
3. The affected URL(s), endpoint(s), or commit hash.
4. Your assessment of the severity (Critical / High / Medium / Low) and
   why.
5. Whether you intend to publish a write-up, and on what timeline (so
   we can coordinate disclosure).

If the vulnerability touches Protected Health Information (PHI), tenant
isolation, authentication, or audit-trail integrity, please flag that
explicitly in the subject line — those reports get fast-tracked.

## 3. Our commitments to you

| Within | We will |
|---|---|
| 24 hours | Acknowledge receipt of your report. |
| 5 business days | Provide an initial assessment (severity, in/out of scope, next steps). |
| 30 days (target) | Deploy a fix for High and Critical vulnerabilities. |
| 90 days (default) | Coordinate public disclosure. We will agree on a date with you and stick to it. |

Embargo extensions are possible for complex vulnerabilities or where
multi-tenant deployments need staged remediation; we will tell you in
advance and give a concrete revised date.

## 4. Safe-harbour testing rules

We support good-faith security research. If you follow the guidelines
below, we will not take legal action against you and we will not ask
your employer to.

You may:

- Test the **staging** environment at any reasonable intensity (no
  thousand-RPS floods).
- Test the production environment **only** for read-side issues that
  cannot affect other users (e.g. CSP / header inspections), and only
  after notifying us in advance.
- Use any account you have provisioned yourself.
- Use automated scanners against your own data and your own assessment
  records.

You may NOT:

- Access or modify data that is not your own.
- Attempt to extract PHI from any patient record other than synthetic
  test data you created.
- Conduct denial-of-service testing against production.
- Use social-engineering attacks against Uelfy staff or tenant
  clinicians.

## 5. Out of scope

The following are typically NOT in scope (please do not report unless
you have a concrete chained exploit):

- Reports from automated scanners with no proof of exploitability.
- Missing best-practice headers when no concrete attack is demonstrated
  (e.g. "you don't have header X" with no chain).
- Issues that require physical access to a clinician's logged-in
  device.
- Self-XSS that requires the victim to paste code into their console.
- CSRF on endpoints that perform no state change.
- Vulnerabilities in third-party services (Supabase, Vercel, etc.) —
  please report those upstream; we will triage on request.

## 6. Cryptography

If you wish to encrypt your report:

> Public PGP key: not yet published.
>
> Once published it will be available at
> `https://<production-domain>/.well-known/uelfy-security.asc`
> and fingerprinted in this section. Until then, transport-encrypted
> email (TLS) is acceptable for initial contact, and we can move to
> end-to-end encryption on the second exchange if the report is
> sensitive.

## 7. Acknowledgements

We thank security researchers who follow this policy. With your
permission, we will list you on our acknowledgements page after the
embargo lifts. Researchers may opt out of acknowledgement.

We do not currently run a paid bug bounty programme. If you find a
material vulnerability, we are happy to discuss a discretionary award
on a case-by-case basis.

## 8. References

- This policy follows [RFC 9116](https://datatracker.ietf.org/doc/html/rfc9116)
  for the machine-readable `security.txt` companion at
  `/.well-known/security.txt`.
- Internal cross-references for the Uelfy team:
  - `docs/20-SECURITY.md` — security architecture (engineering view).
  - `docs/27-INCIDENT-RESPONSE.md` — incident response playbook,
    including processor → controller notification SLA.
  - `docs/22-GDPR-READINESS.md` Art.33/34 — breach-notification flow
    when a vulnerability has been exploited.

---

*If anything in this policy is unclear or you would like to suggest an
improvement, please email `security@uelfy.com` — we appreciate it.*
