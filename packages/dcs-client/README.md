# @ip-lms/dcs-client

Typed client for the DCS/Gitea API (OAuth2 auth, content read/write,
catalog search, repo/org management) — see `API_DCS.md` for the
endpoints this wraps and `ARQUITECTURA.md` §3.4 for why it's its own
package (isolating the Gitea API from the rest of the app).

## Testing

There are two, separate test suites:

- **`pnpm test`** (also just `vitest run`) — the default, always-on
  suite. Every call goes through a mocked `fetch`; nothing ever reaches
  a real server. This is what CI runs and what runs as part of the
  whole workspace's `pnpm test`.
- **`pnpm test:integration`** — opt-in, live network calls against a
  real DCS server. **Always QA (`https://qa.door43.org`), never
  production** — see `.env.example` at the repo root.

### Running the integration suite

1. Copy the repo-root `.env.example` to `.env` (already gitignored).
2. Generate a personal access token on QA: go to
   `https://qa.door43.org/user/settings/applications` while logged in
   to a QA account, click "Generate New Token", and give it `repo`,
   `write:repository`, `write:org`, and `write:user` scopes. Put the
   token in `.env` as `DCS_TOKEN` — **never your password**, the token
   is the only secret this suite needs.
3. Set `DCS_TEST_OWNER` to that account's username. Optionally set
   `DCS_TEST_ORG` to an org the token can read, to also exercise the
   org-repo calls.
4. Run `pnpm test:integration` from this package (or
   `pnpm --filter @ip-lms/dcs-client test:integration` from the repo
   root).

With no `DCS_TOKEN`/`DCS_TEST_OWNER` set, `qa.integration.test.ts`
skips itself entirely (including when it runs as part of the default
`pnpm test`) — so cloning the repo with no `.env` is still a fully
green, fully offline `pnpm test`.

The suite creates exactly one throwaway repo under `DCS_TEST_OWNER`
(name-scoped to the run's timestamp), writes and reads back one file
in it, then deletes both the file and the repo in `afterAll` — even if
an assertion above failed. If `DCS_TEST_ORG` is set it also reads
(never writes) that org's info/repos to confirm the token has real
access to it.

### A note on where this can actually run

Both the Claude cloud sandbox and its linked-device shell used to
build this package are behind an organization network policy that
blocks `qa.door43.org` outright (403 at the proxy). That's a policy
decision on this Claude session, not anything about DCS or this
client — `pnpm test:integration` will work anywhere without that
restriction (your own machine's normal terminal, CI with the host
allowed, etc.).
