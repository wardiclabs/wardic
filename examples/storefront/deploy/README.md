# Deploying the storefront demo

The three apps (Solid 1, Solid 2, and Motion on Next.js) on one Linux VPS, from one Docker image, behind [Caddy](https://caddyserver.com), which serves each on its own subdomain with HTTPS:

| Address | What |
|---|---|
| `https://<domain>` | A landing page: which app to open (`landing/index.html`) |
| `https://solid1.<domain>` | Wardic on Solid 1 |
| `https://solid2.<domain>` | Wardic on Solid 2 |
| `https://motion.<domain>` | The same examples in Motion on Next.js |

Each app runs as it does in the smoke test: the Solid apps under `vite preview`, the Next.js app under `next start`. Caddy in front adds HTTPS and compression, and flushes the live feeds as they stream. The store keeps everything in memory, one store per app, so a restart empties every cart, and the apps restart each night at 04:30 (server time) to keep that memory bounded.

## Sizing

4 GB of RAM is enough to build and run (measured, #366): the three apps use about 630 MB, and a cold build of all three peaks at 1.8 GB on 2 cores, or 1.6 GB on 1. With only 2 GB, the Next.js build runs out of memory beside the running apps.

## First setup

1. **The server:** Ubuntu 24.04 (Hostinger's Docker template has Docker already), with your SSH key, and the deploy key of the machine that deploys.
2. **DNS:** an `A` record for `<domain>` and for `*.<domain>` (or `solid1`, `solid2` and `motion` each), pointing at the server. To try it first with no DNS at all, use `<server-ip>.sslip.io` as the domain: `solid1.<server-ip>.sslip.io` and the rest resolve to the server by themselves, and get real certificates.
3. **Set it up**, as root, once:
   ```sh
   ssh root@<server> 'bash -s' < examples/storefront/deploy/setup-server.sh <domain>
   ```
   That makes a `deploy` user with root's SSH keys, 2 GB of swap, a firewall that lets in only SSH, HTTP and HTTPS, automatic security updates, the domain in `.env`, and the nightly restart.
4. **Check `ssh deploy@<server>` lets you in with your own key**, then turn off passwords and root's login:
   ```sh
   ssh deploy@<server> 'sudo bash -s' < examples/storefront/deploy/lock-ssh.sh
   ```
5. **An `~/.ssh/config` entry** on the machine that deploys:
   ```
   Host storefront-deploy
     HostName <server>
     User deploy
     IdentityFile ~/.ssh/<its key>
     IdentitiesOnly yes
   ```

Hostinger's own firewall (hPanel) is worth turning on too, allowing only 22, 80 and 443.

## Deploy

From a clean checkout, at the commit to deploy:

```sh
examples/storefront/deploy/deploy.sh
```

It copies the source to the server (the repo is private: the server has no git access of its own), builds the image there, and restarts the apps whose image changed. Caddy keeps its certificates in a volume across deploys.

Then check it from outside: the smoke test runs against a deployment when `STOREFRONT_SMOKE_URL` names it (and `STOREFRONT_NEXT_URL` where a Solid app's Motion tab should link), starting nothing itself:

```sh
cd examples/storefront/solid2   # or solid1, or next (its address: motion.<domain>)
STOREFRONT_SMOKE_URL=https://solid2.<domain> STOREFRONT_NEXT_URL=https://motion.<domain> bun ../shared/src/smoke.ts solid2
```

On the server, in `~/wardic/examples/storefront/deploy`:
- `docker compose ps`, `docker compose logs -f next`: what's running, and what it says;
- `docker compose restart solid2`: one app again;
- `docker compose down`: everything off (certificates kept).
