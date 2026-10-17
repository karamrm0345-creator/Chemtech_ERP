# Deployment guide

## 1. Server

- Linux VM (e.g. Ubuntu 24.04), 2+ vCPU, 4 GB RAM minimum, SSD.
- Node.js 20 or 22 LTS, PostgreSQL 14+ (same host or managed service), nginx or Caddy for HTTPS.
- Server clock in UTC. The application formats all business dates in **Asia/Qatar**.

## 2. Database

```sql
CREATE USER chemtech WITH PASSWORD '<strong password>';
CREATE DATABASE chemtech_erp OWNER chemtech;
```

Restrict `pg_hba.conf` to the application host. Use TLS (`?sslmode=require`) for remote databases.

## 3. Application

```bash
sudo useradd -r -m -d /opt/chemtech chemtech
sudo -u chemtech git clone <repo> /opt/chemtech/app && cd /opt/chemtech/app
sudo -u chemtech npm ci
sudo -u chemtech cp .env.example .env && sudo -u chemtech chmod 600 .env
#   DATABASE_URL=postgresql://chemtech:<pw>@db-host:5432/chemtech_erp?schema=public
#   SESSION_SECRET=<openssl rand -base64 48>
#   UPLOAD_DIR=/var/lib/chemtech/uploads     (outside the app & web root; chmod 700, owned by chemtech)
sudo -u chemtech npx prisma migrate deploy
sudo -u chemtech npm run db:seed:base
sudo -u chemtech npm run build
```

### systemd unit `/etc/systemd/system/chemtech-erp.service`

```ini
[Unit]
Description=Chemtech ERP
After=network.target postgresql.service

[Service]
User=chemtech
WorkingDirectory=/opt/chemtech/app
Environment=NODE_ENV=production
Environment=PORT=3000
ExecStart=/usr/bin/npm start
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now chemtech-erp
```

### nginx (HTTPS termination)

```nginx
server {
  listen 443 ssl http2;
  server_name erp.chemtech.example;
  ssl_certificate     /etc/letsencrypt/live/erp.chemtech.example/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/erp.chemtech.example/privkey.pem;
  client_max_body_size 12m;            # attachments are limited to 10 MB
  add_header Strict-Transport-Security "max-age=31536000" always;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;   # used for audit IP & login rate limiting
    proxy_set_header X-Forwarded-Proto https;
  }
}
```

Session cookies are `Secure` in production, so the site must be served over HTTPS.

## 4. First administrator

Either browse to `https://erp…/setup` (works only while there are no users), or:

```bash
ADMIN_EMAIL=it@chemtech.example ADMIN_NAME="IT Administrator" ADMIN_PASSWORD='<strong>' npm run admin:create
```

Then sign in, configure **Company settings** and create users. Do **not** run `db:seed:demo` in production; it refuses to run there.

## 5. Upgrades

```bash
cd /opt/chemtech/app
pg_dump -Fc chemtech_erp > /var/backups/chemtech/pre-upgrade-$(date +%F).dump
git pull && npm ci && npx prisma migrate deploy && npm run db:seed:base && npm run build
sudo systemctl restart chemtech-erp
```

## 6. Scaling notes

- Login rate limiting is in-memory. If you run more than one app instance behind a load balancer, move it to a shared store (e.g. Redis) or enable sticky sessions.
- Attachments are on local disk (`UPLOAD_DIR`). With several instances, use a shared volume or move storage to an object store.
