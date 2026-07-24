# Deploying FlowCue AI for the Beta

The beta plan and landing page assume testers can open a real URL. Right now the app
only runs via `npm run dev` on your own machine, so nothing is reachable by testers yet
— this is the one missing piece before outreach can actually start.

**Important:** live speech recognition (the Web Speech API) requires either `localhost`
or a page served over **HTTPS**. Every option below serves HTTPS by default, so this is
handled for you as long as you use one of them rather than a plain HTTP host.

## Fastest path: Netlify drag-and-drop (~2 minutes, free, no account required to start)

1. Go to https://app.netlify.com/drop
2. Drag the `dist/` folder (already built, sitting alongside this file) — or the
   `flowcue-web-dist.zip` archive — onto the page.
3. Netlify gives you a live HTTPS URL immediately (e.g. `random-name-123.netlify.app`).
4. Optional: claim a free account to keep the site and set a custom subdomain
   (Site settings → Change site name).

This is the recommended path for getting a URL in front of beta testers today. No
build step, no CLI, no config file needed — `dist/` is already a static site.

## Alternative: Vercel CLI

```bash
npm install -g vercel
cd webapp
vercel --prod
```

Follow the prompts (first run asks you to log in). Vercel builds from source using the
existing `npm run build` script, so you can point it at the `webapp/` folder directly
instead of `dist/`.

## Alternative: GitHub Pages

1. Push this `webapp/` folder to a GitHub repo.
2. In `vite.config.ts`, set `base: '/<your-repo-name>/'` (required for project pages).
3. `npm run build`, then deploy the `dist/` folder to the `gh-pages` branch (the
   `gh-pages` npm package automates this: `npm install -D gh-pages`, add a `deploy`
   script running `gh-pages -d dist`, then `npm run deploy`).

Slightly more setup than Netlify/Vercel, but free and keeps everything inside GitHub if
that's already your workflow.

## After deploying

- **Rebuilding a new URL isn't a redeploy of history** — localStorage data lives in each
  tester's browser, tied to the domain they used. If you move from a Netlify preview URL
  to a custom domain later, existing testers' scripts and session history won't follow
  automatically. Pick a URL you're willing to stick with for the beta's duration before
  sending outreach messages.
- Update the landing page (`landing/index.html`) and any outreach messages already sent
  with the real URL — they currently don't hardcode one, so this is a one-time addition,
  not a rewrite.
- Re-run `npm run build` and redeploy any time you change `src/` — none of the hosts
  above auto-deploy from this sandbox; each requires you to push the new `dist/` (or,
  for Vercel/GitHub Pages, the new source) yourself.
