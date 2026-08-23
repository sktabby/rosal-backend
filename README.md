# Rosal Safety OMS — Backend

Shared NestJS + Prisma + PostgreSQL backend for the Rosal Safety Order Management
System. Consumed by both the **Web Portal** (Next.js — Admin/Dispatcher/Accounts)
and the **Android App** (Kotlin/Compose — Sales/Dispatcher).

This implements everything in the backend reference doc: Employee Code + OTP auth,
the PI → SalesOrder → Bill → Invoice lifecycle, role-scoped data access, Socket.io
real-time events, and object-storage file uploads.

> **v1.1 update applied** — real GST tax-invoice fields (Consignee/Buyer blocks,
> e-Way Bill No., Transporter, Round Off, per-line Discount %), CompanySettings
> banking/UDYAM/PAN fields, Transport GSTIN, FactoryUnit dispatch address, and the
> 48-hour Dispatched→History visibility window. See §11 below for the full list
> and a couple of judgment calls worth double-checking.

---

## 1. Prerequisites

- Node.js 20+
- npm (this project is set up for npm, per your choice)
- A PostgreSQL database — Neon free tier is what the plan uses for dev:
  https://neon.tech → New Project → copy the **Prisma**-formatted connection string

---

## 2. First-time setup

```bash
cd backend
npm install
cp .env.example .env
```

Open `.env` and fill in:

1. **`DATABASE_URL`** — paste your Neon connection string (Prisma tab in Neon's dashboard). This is the only value you strictly need to run the app locally.
2. **`JWT_SECRET`** — any long random string (e.g. `openssl rand -hex 32`).
3. Everything else (SMTP, Twilio, S3/R2) can stay as placeholders for now —
   OTP email/SMS and file upload will simply log/fail gracefully until you
   wire in real credentials. Auth still works end-to-end because the OTP is
   generated and checked server-side regardless of whether delivery succeeds
   — for local dev, check your terminal logs for the `[SMS STUB]` line, and
   check the SMTP inbox you configured (or a service like Mailtrap/Ethereal
   for a throwaway dev inbox) for the email OTP.

---

## 3. Database: generate client + run migrations

```bash
npm run prisma:generate     # generates the Prisma Client from schema.prisma
npm run prisma:migrate      # creates tables in your Neon DB (prompts for a migration name)
npm run prisma:seed         # creates the CompanySettings singleton + bootstrap Admin
```

The seed script creates one Admin account so you have something to log in with:

```
Employee Code: ADMIN-0001
Password:      ChangeMe123!
```

⚠️ Change this password immediately after your first login (or delete/edit
the seeded user directly via Prisma Studio) — it's a well-known default.

You can inspect/edit data visually at any time with:

```bash
npm run prisma:studio
```

---

## 4. Run it

```bash
npm run start:dev
```

Server boots at `http://localhost:4000/api` (see `PORT` in `.env`). All routes
are prefixed with `/api` — e.g. `POST http://localhost:4000/api/auth/login`.

Socket.io is on the same server, namespace `/realtime` — e.g.
`ws://localhost:4000/realtime`, authenticated via
`socket.handshake.auth.token = "<JWT>"`.

---

## 5. Quick smoke test (curl)

```bash
# 1. Login (triggers OTP — check terminal/SMTP inbox)
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"employeeCode":"ADMIN-0001","password":"ChangeMe123!"}'

# 2. Verify OTP (use the code from your terminal/email)
curl -X POST http://localhost:4000/api/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{"employeeCode":"ADMIN-0001","otp":"123456"}'
# -> returns { accessToken, role, user }

# 3. Use the token for authenticated calls
curl http://localhost:4000/api/account/me \
  -H "Authorization: Bearer <accessToken>"
```

From there, as Admin you can create the master data needed before the app/web
portal can do anything useful: a Dispatcher user → a Factory Unit (assigns
that dispatcher) → a Seller user → a Client (assigned to that seller) → a
Product → a Transport option. Then the Seller can create a PI, confirm it
into an Order, and the lifecycle is live.

---

## 6. Project structure

```
backend/
  prisma/
    schema.prisma       # full data model — 10+ tables, all enums
    seed.ts              # CompanySettings singleton + bootstrap Admin
  src/
    main.ts               # bootstrap, global pipes/filters, CORS, helmet
    app.module.ts          # wires every feature module + global auth/roles guards
    prisma/                # PrismaService (global)
    common/                 # @Roles, @Public, @CurrentUser decorators; guards; id-gen utils
    auth/                    # Employee Code + password + shared OTP -> JWT
    users/                   # Admin-only user creation/management
    clients/                 # GSTIN-unique, seller-scoped
    products/                # HSN 12-digit validation
    transport/
    factory-units/           # 1:1 dispatcher constraint
    company-settings/        # singleton header block (PI/Bill/Invoice)
    proforma-invoices/       # Draft/Confirm/editLocked lifecycle
    sales-orders/            # freeze snapshot, accept/complete/reject/cancel
    bills/                   # Seller-created, computed from frozen order
    invoices/                # Accounts-created, THE legal GST doc, manual gstType
    order-events/            # audit log service, used by every module
    realtime/                # Socket.io gateway, room-scoped events
    uploads/                 # S3-compatible (Cloudflare R2 / Backblaze B2)
    search/                  # Admin global search
    dashboard/                # /admin/dashboard-summary, /app/home-summary, /app/dispatcher-summary
```

---

## 7. Security hardening applied (post-scan)

A full pass against the project's security checklist turned up and fixed:

- **IDOR on `GET /bills/:id`** — a Seller could previously read another seller's bill by ID; now scoped server-side.
- **GSTIN format validation** — `Client.gstin` and `CompanySettings.gstin` now validate the actual 15-char GSTIN pattern, not just uniqueness.
- **Rate limiting** (`@nestjs/throttler`) — global default 100 req/min/IP, with tighter overrides: login 5/min, OTP verify 5/min, OTP resend 1/30s, order create/cancel 20/min.
- **`POST /auth/resend-otp`** — was missing entirely despite the OTP screen's "Resend" UI; added, with old OTPs invalidated on resend and a 5-per-15-min ceiling.
- **Socket.io CORS** — was hardcoded to `origin: '*'`; now respects `CORS_ORIGINS` like the REST API (browser/web-portal concern only — Android's socket.io-client doesn't do CORS preflight).
- **Upload validation** — PDF-only MIME check (not just filename extension), 10MB cap, and `ContentDisposition: attachment` on the stored object so it can't render inline in a browser.
- **Startup env validation** — the app now refuses to boot if `DATABASE_URL` or `JWT_SECRET` is missing or still a placeholder, instead of silently running broken.
- **Prisma error mapping** — `P2025`/`P2002` now map to proper 404/409s instead of a blanket 500; all other unhandled errors get a correlation ID in the response and full detail only in the server log (never a stack trace to the client).
- **Admin audit-trail endpoint** — `GET /order-events/:entityType/:entityId` was implemented in the service but never exposed via a controller; added.

---

## 8. What's stubbed vs. production-ready

**Production-ready logic:**
- Full auth flow (Employee Code + password + shared OTP → JWT), RBAC guards
- PI edit-lock / SalesOrder freeze-snapshot / cancel-unlocks-PI lifecycle
- Server-side recomputation of Bill and Invoice amounts (never trusts client math)
- Role-scoped data access enforced in every service (not just UI-level)
- Socket.io room scoping matching the event table exactly
- Soft-delete everywhere on master data (never hard-delete, preserves FK integrity)

**Stubbed — wire in before going to production:**
- **SMS delivery** (`src/auth/otp-delivery.service.ts`) — logs to console instead of
  sending. Swap in Twilio (partially scaffolded) or an India-specific provider
  like MSG91.
- **Invoice PDF generation** (`src/invoices/invoices.service.ts`) — needs a
  headless-render step (e.g. Puppeteer + HTML template) once you finalize the
  layout against your handwritten reference format (flagged as an open item
  in the spec).
- **FCM push notifications** — Socket events fire correctly; the FCM push
  calls alongside them (order:completed "please bill it", etc.) are commented
  as TODOs where they belong.
- **PI auto-archival** — `proformaInvoicesService.archiveStaleDrafts()` exists
  and works, but needs a scheduler wired in (`@nestjs/schedule`'s `@Cron`, or
  an external cron hitting a protected endpoint) to actually run daily.

---

## 9. Still open (lower priority — not fixed yet)

- `User.lastLoginDevice` is hardcoded to `"Unknown device"` — should parse the client's `User-Agent` header instead.
- PI auto-archival (`archiveStaleDrafts()`) exists but isn't scheduled — wire up `@nestjs/schedule`'s `@Cron` or an external cron.
- Session invalidation on password change (force logout elsewhere) — noted as an open item in the original spec, still undecided.
- Invoice PDF template and FCM push wiring — see §8 above.

---

## 10. Next steps in the plan

1. ✅ Backend scaffold (this)
2. Run migrations against Neon, smoke-test the flows above
3. Android app scaffold with mock repositories (parallel track, doesn't block on backend)
4. Wire Android to real endpoints once verified
5. Web portal (Next.js) — same backend, built once the API contract is proven

---

## 11. v1.1 update — what changed and two judgment calls to check

**Schema additions:**
- `CompanySettings`: `udyamNumber`, `panNumber`, `bankName`, `bankAccountNo`, `bankIFSC`, `bankBranch`, `authorisedSignatory`
- `Transport`: `gstin` (optional)
- `FactoryUnit`: `address` (optional) — used as the Invoice's "Dispatch From" when set
- `PiLineItem` / `BillLineItem`: `discountPercent` (default 0), applied before tax
- `Invoice`: fully expanded to match the real tax-invoice format — `invoiceNumber`, `eWayBillNo`, `dispatchDocNo`, `termsOfDelivery`, transporter/consignee/buyer snapshots, `roundOff`, `amountInWords`, and a frozen `companySettingsSnapshot` (JSON) captured at generation time so a later edit to Company Settings can't retroactively change an already-issued invoice
- New `InvoiceLineItem` model — generated from the Bill's line items at Invoice-creation time (same freeze pattern as `SalesOrder.lineItemsSnapshot`)

**Behavior additions:**
- `GET /orders` now accepts `history=true` to bypass the new 48-hour Dispatched visibility window. Default (omitted/false) = active-list semantics: DISPATCHED orders older than 48h from `completedAt` are excluded, as if already moved to History. **Every screen that shows an "active" order list (Dispatcher Queue, Seller Orders List, Seller Billing List) should call without `history`; every History screen should call with `history=true`** — otherwise old dispatched orders will vanish from History too, which isn't the intent.
- `GET /pi?clientId=&sellerId=me` (the Create-Order fetch step) now returns only PIs that are actually orderable: not `editLocked`, not Cancelled/Archived, created within the last 30 days.

**Two judgment calls worth double-checking against what you actually intended:**
1. The PI patch note says the Create-Order fetch should show PIs "still Draft/unconfirmed." I implemented it to also include CONFIRMED-but-unlocked PIs (the cancel-then-recreate case), since excluding those would silently break the existing cancel → edit → re-order flow. If you meant DRAFT-only, that's a one-line change in `proforma-invoices.service.ts` → `findOrderableForClient`.
2. `Invoice.consigneeState` / `buyerState` are accepted as optional manual input on `POST /invoices` rather than derived automatically — the `Client` model has no structured `state` field (only a free-text `address`), so there's nothing reliable to derive it from. If you want it auto-derived, the cleanest fix is decoding the first 2 digits of the GSTIN against a state-code lookup table, or adding a real `state` column to `Client`.
