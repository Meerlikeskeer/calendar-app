# Universal Household Planner

A Vite + React + TypeScript SPA for planning the shared work of a household. The app is built on React Router 7, Tailwind CSS v4, shadcn/ui with Base UI, Convex, Convex Auth, Zustand, next-themes, Lucide icons, and shadcn Sonner.

## Run

Use the Codex helper on Windows:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\codex-run.ps1
```

The helper installs dependencies with Bun, configures Convex when `.env.local` is missing, and starts Convex with the Vite dev server. When Convex asks for a team, choose your personal team. To skip that prompt, set `CONVEX_TEAM` first.

Manual commands:

```bash
bun install
bun run dev
```

`bun run dev` runs `convex dev` and starts the Vite app through `bun run dev:web`.

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
- [x] PIN-gated profile picker for Neelam, Meer, Vaani, and Haashi.
- [x] Personal task CRUD with assignment, timestamps, category tags, links, and Done/Reopen actions.
- [x] Shared household hub for communal tasks with daily/weekly reset metadata.
- [x] Productivity log of completed tasks.
- [x] Reminder panel for morning digests, due-soon alerts, and assignment notifications.
- [x] AI command surface for household pulse, quick task creation, and MFA-gated home-control routing.
- [x] Convex schema and functions for users, tasks, notifications, and home controls.
- [x] WebSocket-backed Convex bridge when `VITE_CONVEX_URL` is configured, with local seeded fallback when it is not.

Still future-facing:

- [ ] Production-grade auth providers, invitation flows, and per-household membership boundaries.
- [ ] Real push/email delivery workers for reminders and digests.
- [ ] Real smart-home vendor adapters for sprinklers, climate, locks, and audit logging.
- [ ] Native mobile shell or PWA install polish.

## Security Notes

- Keep `.env.local` local. Do not commit Convex, auth provider, API, or webhook secrets.
- Treat `VITE_*` environment variables as public browser-exposed values.
- The current PINs are prototype UI gates. Replace them with Convex Auth-backed credentials before production use.
- Enforce household membership and role checks in Convex functions, not only in React UI.
- Scope every household record by household or membership identity to avoid cross-household data exposure.
- Validate and normalize user-provided text, dates, recurrence rules, URLs, and invite targets on the server.
- Avoid storing sensitive documents or emergency details until retention, access, and deletion behavior is explicit.

## Manual Verification Plan

- Start the app and confirm the public dashboard loads without signing in.
- Unlock each profile with prototype PIN `1234`.
- Add, edit, complete, reassign, and delete tasks, including a payment task with critical PIN `2468`.
- Toggle week, month, and year views and verify category colors remain consistent.
- Queue a morning digest and route an AI home-control command with critical PIN `2468`.
- Run `bun run lint`, `bun run typecheck`, and `bun run build` before handoff.
