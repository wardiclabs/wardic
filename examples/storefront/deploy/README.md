# Deploying the storefront demo

The apps (Solid 2's and Foldkit's; Solid 1's isn't deployed, #566) on one Linux VPS, from one Docker image, behind [Caddy](https://caddyserver.com), which serves each on its own subdomain with HTTPS:

| Address | What |
|---|---|
| `https://<domain>` | A landing page: which app to open (`landing/index.html`) |
| `https://solid2.<domain>` | Wardic on Solid 2 |
| `https://foldkit.<domain>` | Wardic on Foldkit |
| `https://solid1.<domain>` | A permanent redirect to `solid2` (#566): Solid 1's app is no longer deployed |

Each app runs as it does in the smoke test, the Solid 2 app under `vite preview`, the Foldkit app on its Node host (`@foldkit/node`, `server.ts`). Caddy in front adds HTTPS, compresses the Foldkit host's answers (its Node host sends them plain, where `vite preview` compresses Solid 2's own), and flushes the live feeds as they stream. The store keeps everything in memory, one store per app, so a restart empties every cart, and the apps restart each night at 04:30 (server time) to keep that memory bounded.

## Sizing

4 GB of RAM is enough to build and run (measured with three apps, #366, the Next.js one since removed, #826, and Solid 1's no longer deployed, #566): they used about 630 MB, and a cold build of all three peaked at 1.8 GB on 2 cores, or 1.6 GB on 1.

## First setup

1. **The server:** Ubuntu 24.04 (Hostinger's Docker template has Docker already), with your SSH key, and the deploy key of the machine that deploys.
2. **DNS:** an `A` record for `<domain>` and for `*.<domain>` (or `solid2` and `foldkit`, and `solid1` for its redirect, each), pointing at the server. To try it first with no DNS at all, use `<server-ip>.sslip.io` as the domain: `solid2.<server-ip>.sslip.io` and the rest resolve to the server by themselves, and get real certificates.
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

It copies the source to the server (the repo is private: the server has no git access of its own), builds the image there, and restarts the apps whose image changed. A deploy that changes the Caddyfile recreates Caddy too, since the file is bind-mounted on its own and the mount keeps the copy rsync replaced; Caddy keeps its certificates in a volume across deploys, so a recreate loses none.

Then check it from outside: the smoke test runs against a deployment when `STOREFRONT_SMOKE_URL` names it, starting nothing itself:

```sh
cd examples/storefront/solid2   # or foldkit
STOREFRONT_SMOKE_URL=https://solid2.<domain> bun ../shared/src/smoke.ts solid2
```

On the server, in `~/wardic/examples/storefront/deploy`:
- `docker compose ps`, `docker compose logs -f solid2`: what's running, and what it says;
- `docker compose restart solid2`: one app again;
- `docker compose down`: everything off (certificates kept).
