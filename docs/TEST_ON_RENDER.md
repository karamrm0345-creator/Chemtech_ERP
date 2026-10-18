# Test Chemtech ERP online for free (Render.com)

This gives you a temporary web address (e.g. `https://chemtech-erp.onrender.com`) with **fictional demo data**,
so you and colleagues can try the system before you rent a real server.

> Test only. On Render's free plan the app sleeps after 15 minutes without visitors (the first visit then
> takes about a minute), the database is deleted after 30 days, and uploaded files are lost on restart.
> Do not enter real company data. For live use, follow [DEPLOYMENT.md](DEPLOYMENT.md).

## Steps (about 15 minutes, mostly waiting)

1. Go to https://render.com and click **Get Started**. Sign up with **GitHub** (account `karamrm0345-creator`).
2. In the Render dashboard click **New +** → **Blueprint**.
3. Connect GitHub if asked, and select the repository **Chemtech_ERP**. Render finds `render.yaml`.
4. Render asks for **DEMO_PASSWORD**. Enter a password of at least 10 characters with letters and numbers,
   for example `ChemDemo2026`. Click **Apply** / **Deploy Blueprint**.
5. Wait until the `chemtech-erp` service shows **Live** (the first build takes 10–15 minutes).
   The log ends with `▶ Chemtech ERP is starting`.
6. Open the address shown at the top of the service page (`https://chemtech-erp-xxxx.onrender.com`).
7. Sign in as `gm@chemtech.demo` with your DEMO_PASSWORD. Other demo users:
   `sales.manager@`, `sales.officer@`, `procurement.manager@`, `procurement.officer@`, `store.manager@`,
   `storekeeper@`, `finance@`, `auditor@`, `admin@` — all `@chemtech.demo`, same password.

## If something goes wrong

- **Build failed**: open the service → **Logs**, and send the last 30 lines to your developer.
- **"DEMO_SEED=1 needs DEMO_PASSWORD"**: service → **Environment** → set `DEMO_PASSWORD` → **Save, rebuild and deploy**.
- **Out of memory** on the free plan: service → **Settings** → change instance type to **Starter** (paid, about $7/month).
