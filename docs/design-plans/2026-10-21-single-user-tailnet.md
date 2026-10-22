# Single-User Tailnet Deployment Design

## Summary

Fleeting has one user. Today it is a public site (`lookonmy.works`, built
and published by Netlify on every push to `main`) with a general-purpose
login screen that accepts any Mastodon instance and any Bluesky handle. This
change makes it a private, single-user app: it is served only on the
operator's tailnet from `deepthought`, and the login screen offers exactly
the operator's two accounts.

Bluesky OAuth cannot work on a tailnet-only host. The Bluesky authorization
server fetches the client metadata document (`/oauth/client-metadata.json`)
from the app's origin over the public internet, and a tailnet host does not
answer it. So Bluesky login becomes app-password only, and the OAuth code
paths are removed rather than left dead. Mastodon OAuth is unaffected: its
redirect happens in the browser, so the instance never contacts the app.

## Definition of Done

- The app is reachable at `https://fleeting.peafowl-polaris.ts.net` from
  tailnet devices, and from nowhere else.
- The response headers there include the same CSP and security headers that
  the build writes for Netlify today.
- The login page shows two entries: `@luis_in_brief@social.coop`
  (Mastodon, OAuth on social.coop) and `@lu.is` (Bluesky, app-password
  field only). There is no free-text instance or handle field.
- Bluesky OAuth is gone: no `oauth.js`, no `@atproto/oauth-client-browser`
  dependency, no client-metadata emit in `vite.config.js`, no OAuth callback
  branch in `app.jsx`.
- Bluesky DMs work with an app password created with "Allow access to your
  direct messages".
- A push to `main` deploys without a manual step.
- The Netlify site is deleted. `lookonmy.works` stays registered and
  serves nothing.
- `CLAUDE.md`, `README.md` and `~/NOTES.md` describe the tailnet deployment.

## Login: fixed accounts

The two accounts are set at build time in a new env var, declared in
`env.schema.json`:

```
FLEETING_ACCOUNTS=mastodon:luis_in_brief@social.coop,bluesky:lu.is
```

When the variable is set, `src/pages/login.jsx` renders one entry per
account in place of the instance and handle inputs:

- **Mastodon entry:** a button that runs the existing `submitInstance`
  flow for `social.coop`. The username shows on the button only. As far as
  this design knows, Mastodon's authorize page has no login-hint parameter,
  so the username is not passed to the instance (not checked).
- **Bluesky entry:** the handle shows as fixed text, and the form has only
  the app-password field and the link to create an app password.

When the variable is not set, the page keeps its stock behavior. The values
live in the deploy configuration, not in source code, which keeps the diff
small against upstream Phanpy. Both handles are public, so leaving them in
a public build has no cost.

## Removing Bluesky OAuth

Files and paths to remove or simplify:

- `src/utils/bluesky/oauth.js`: delete.
- `src/utils/bluesky/client.js`: remove the OAuth agent, the `deleted` and
  `updated` event handling, and `resetOAuthClient` use. The client then
  has only the password-session path.
- `src/utils/bluesky/index.js`: remove `blueskyAuth === 'oauth'` branches,
  `clearBlueskyAuthExpired`, and `reviveExpiredBlueskyAccounts`. Keep
  `authExpired` for password accounts whose refresh token is truly dead.
- `src/utils/acting-accounts.js`: remove the `blueskyAuth === 'oauth'`
  branch.
- `src/app.jsx`: remove the Bluesky OAuth callback branch and the
  `reviveExpiredBlueskyAccounts` call.
- `src/pages/login.jsx`: remove the `<details class="bluesky-oauth">`
  form and `signInBlueskyOAuth`.
- `vite.config.js`: remove the `oauth/client-metadata.json` emit.
- `package.json`: remove `@atproto/oauth-client-browser`.
- `CLAUDE.md`: rewrite "Session death is proven, never announced" for the
  password-only client.

No stored-data migration is needed. The tailnet host is a new origin, so
its browser storage starts empty and no OAuth account record ever exists
there.

## Serving

A Caddy Quadlet, `~/.config/containers/systemd/fleeting.container`, serves a
bind-mounted, read-only web root on `127.0.0.1:<port>`. It is published with
`tailscale serve --service=svc:fleeting --https=443`, the same pattern as
`svc:bookorbit`. Routing needs no fallback rules, because the app uses
`HashRouter`.

The CSP is computed in `vite.config.js` and written to the Netlify
`_headers` file. The same build step also writes the headers as a Caddy
snippet in a directory outside the web root. Caddy imports the snippet and
runs with `--watch`, so a deploy that changes the CSP takes effect without a
container restart. The deploy updates web content only. The Caddy image is
pinned and updated by hand, as `~/CONTAINERS.md` requires.

`FLEETING_WEBSITE` becomes the tailnet URL, and `FLEETING_DISALLOW_ROBOTS`
is set.

## Deploys

**Decided 2026-10-21: B, every 10 minutes.** A remains an option if the
delay becomes a problem.

**A. Push from GitHub Actions over Tailscale.** On push to `main`, a workflow builds `dist/` on
the runner. It joins the tailnet as an ephemeral `tag:ci` node with
`tailscale/github-action`, then runs `rsync --delete-after --delay-updates`
into the web root on deepthought. This works like Netlify, with no polling
and no build load on deepthought. It needs these changes, each of which
needs the operator's approval:

- A dedicated local user (for example `fleeting-deploy`) that can write
  only the web root and the header-snippet directory.
- A tailnet policy change: a `tag:ci` owner, and a Tailscale SSH rule that
  allows `tag:ci` to reach deepthought as that user only. Tailscale SSH
  cannot force a command, so the dedicated user is what limits the damage
  a leaked credential can do.
- A Tailscale OAuth client secret stored as a GitHub Actions secret. The
  workflow runs only on push to `main`, so pull requests from forks never
  see it.

**B. Pull on deepthought.** A systemd user timer runs `git ls-remote` every
10 minutes. When `main` has moved, it fetches, builds with `npm ci && npm run
build`, and swaps the web root. This needs no new users, credentials, or
policy. The costs are up to 10 minutes of delay and a build burst on
deepthought for each deploy.

## Cutover

1. Ship the code changes and the Quadlet, and check the tailnet URL from a
   phone and the iPad.
2. Log in on each device at the new URL. Create a Bluesky app password with
   DM access.
3. Delete the Netlify site `phanpy-plus`. Keep the `lookonmy.works`
   registration, with nothing served from it. The domain's DNS zone is
   on Netlify DNS; check that deleting the site does not also delete the
   zone.
4. Log the change in `~/NOTES.md`. Rewrite the deploy sections of
   `CLAUDE.md` and `README.md`.

## Verification

- Unit tests: the `FLEETING_ACCOUNTS` parser; existing Bluesky client tests
  after the OAuth paths are removed.
- `node scripts/verify-sw-recovery.mjs` against the production build, served
  through Caddy, because the service worker recovery depends on how the
  server answers a missing hashed bundle (404, not HTML).
- Browser check on the tailnet URL: both logins, home timeline merge, a
  Bluesky DM, and the CSP header in the response.
- From a host outside the tailnet: the hostname does not resolve or connect.
