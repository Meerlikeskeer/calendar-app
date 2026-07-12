# Universal Household Planner

A Vite + React + TypeScript SPA for planning the shared work of a household. The app is built on React Router 7, Tailwind CSS v4, shadcn/ui with Base UI, Convex, Convex Auth, Zustand, next-themes, Lucide icons, and shadcn Sonner.

## Run

Use the Codex helper on Windows:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\codex-run.ps1
```

The helper installs dependencies with Bun, configures Convex when `.env.local` is missing, and starts Convex with the Vite dev server. When Convex asks for a team, choose your personal team. To skip that prompt, set `CONVEX_TEAM` first.

If Convex was configured as a local deployment, sign into your Convex account and reconnect the project to a cloud deployment:

```powershell
bun run convex:login
bun run convex:configure
```

Choose your existing Convex team and project, then select a cloud development deployment. The project can then be pushed to production with `bun run convex:deploy`.

## Secure Deployment Setup

The calendar will not open until it has a Convex deployment and authenticated session. Set `VITE_CONVEX_URL` in the deployed frontend from your Convex deployment URL, then configure the approved household usernames and a strong, temporary provisioning code in Convex:

```bash
npx convex env set HOUSEHOLD_ALLOWED_USERNAMES "neelam,meer,vaani,haashi"
npx convex env set HOUSEHOLD_SETUP_CODE "replace-with-a-long-random-one-time-code"
```

On the sign-in page, create each approved household account with its username, a unique password of at least eight characters, and the provisioning code. Once every account exists, remove the provisioning code so no further accounts can be created:

```bash
npx convex env remove HOUSEHOLD_SETUP_CODE
```

Existing users can still sign in after the provisioning code is removed. The user allowlist and setup code are server-only Convex environment variables; never place them in `VITE_*` variables or source control.

Manual commands:

```bash
bun install
bun run dev
```

`bun run dev` runs the local Convex CLI through Bun and starts Vite through `bun run dev:web`. This avoids relying on an older system Node.js installation.

## Build And Verify

```bash
bun run lint
bun run typecheck
bun run build
bun run preview
```

There is not a dedicated automated test script yet. Until one is added, use lint, typecheck, build, and a manual smoke test of the planner flows before merging.

## App Structure

- `src/` contains the React app, routes, providers, shared UI components, client state, and styling.
- `convex/` contains Convex Auth, HTTP routes, and the database schema.
- `scripts/codex-run.ps1` bootstraps Bun, Convex configuration, and local development.
- `public/` and `src/assets/` hold static assets.

## Implemented Planner Scope

- [x] Public household pulse with week, month, and year calendar views.
- [x] Strict category colors for chores, classes, bills, appointments, and rituals.
- [x] Convex-backed username/password sign-in with an approved-user allowlist.
- [x] Personal task CRUD with assignment, timestamps, category tags, links, and Done/Reopen actions.
- [x] Shared household hub for communal tasks with daily/weekly reset metadata.
- [x] Productivity log of completed tasks.
- [x] Reminder panel for morning digests, due-soon alerts, and assignment notifications.
- [x] AI command surface for household pulse, quick task creation, and MFA-gated home-control routing.
- [x] Convex schema and functions for users, tasks, notifications, and home controls.
- [x] WebSocket-backed Convex bridge when `VITE_CONVEX_URL` is configured, with local seeded fallback when it is not.

Still future-facing:

- [ ] Invitation flows and per-household membership boundaries for multiple households.
- [ ] Real push/email delivery workers for reminders and digests.
- [ ] Real smart-home vendor adapters for sprinklers, climate, locks, and audit logging.
- [ ] Native mobile shell or PWA install polish.

## Security Notes

- Keep `.env.local` local. Do not commit Convex, auth provider, API, or webhook secrets.
- Treat `VITE_*` environment variables as public browser-exposed values.
- Passwords are handled by Convex Auth and its server-side password hashing. Do not add passwords, setup codes, or access lists to client-side storage.
- All household queries and mutations require an authenticated Convex session. For a multi-household version, add a household membership table and enforce its membership in every function.
- Scope every household record by household or membership identity to avoid cross-household data exposure.
- Validate and normalize user-provided text, dates, recurrence rules, URLs, and invite targets on the server.
- Avoid storing sensitive documents or emergency details until retention, access, and deletion behavior is explicit.

## Manual Verification Plan

- Confirm the loading screen leads to username/password sign-in before the calendar mounts.
- Confirm an unapproved username and an invalid password cannot access the calendar.
- Create approved accounts with the temporary setup code, then remove `HOUSEHOLD_SETUP_CODE` and confirm existing accounts still sign in.
- Add, edit, complete, reassign, and delete tasks, including a payment task with critical PIN `2468`.
- Toggle week, month, and year views and verify category colors remain consistent.
- Queue a morning digest and route an AI home-control command with critical PIN `2468`.
- Run `bun run lint`, `bun run typecheck`, and `bun run build` before handoff.
