# Run Chemtech ERP on your own computer (Docker)

This starts the database and the application together, loads fictional demo data,
and lets you sign in at **http://localhost:3000**. It works on Windows, macOS and Linux.

## 1. Install Docker Desktop (one time)

Download and install it from https://www.docker.com/products/docker-desktop/ and start it.
Wait until it says Docker is running.

## 2. Get the code

Unzip `chemtech-erp-source.zip` (or clone the GitHub repository). Open a terminal in the
`chemtech-erp` folder:

- **Windows:** open the folder in File Explorer, click the address bar, type `powershell`, press Enter.
- **macOS:** right-click the folder in Finder → *New Terminal at Folder*.

## 3. Choose two passwords

Create a file named `.env` in the `chemtech-erp` folder containing two lines (pick your own values):

```
DB_PASSWORD=choose-a-database-password
DEMO_PASSWORD=ChooseDemo123
```

`DEMO_PASSWORD` is the sign-in password for all demo users. It needs at least 10 characters
with letters and numbers.

> If a `.env` file already exists (from a non-Docker install), add the two lines to it.

## 4. Start it

```
docker compose up --build
```

The first start takes a few minutes (it downloads images and builds the app). It is ready when you see:

```
▶ Chemtech ERP is starting on http://localhost:3000
```

## 5. Sign in

Open **http://localhost:3000** and sign in with any demo user and your `DEMO_PASSWORD`:

| Email | Role |
|---|---|
| gm@chemtech.demo | General Manager |
| sales.manager@chemtech.demo | Sales Manager |
| sales.officer@chemtech.demo | Sales Officer |
| procurement.manager@chemtech.demo | Procurement Manager |
| procurement.officer@chemtech.demo | Procurement Officer |
| store.manager@chemtech.demo | Store Manager |
| storekeeper@chemtech.demo | Storekeeper |
| finance@chemtech.demo | Finance Officer |
| auditor@chemtech.demo | Read-Only Auditor |
| admin@chemtech.demo | System Administrator |

Sign out (top-right menu) and sign in as another user to see what each role can do. For example,
prepare an order as the sales officer and approve it as the sales manager.

## Stop, restart, reset

| Action | Command |
|---|---|
| Stop | press `Ctrl + C`, or `docker compose down` |
| Start again (data kept) | `docker compose up` |
| Start in the background | `docker compose up -d` |
| Delete everything and start fresh | `docker compose down -v` ⚠ erases the database and uploads |

## Start without demo data

To begin with an empty system for real use, set `DEMO_SEED=0` in `.env` before the first start
(or after `docker compose down -v`). Opening http://localhost:3000 then shows the one-time setup page
where you create your company administrator.

## Troubleshooting

- **"Set DB_PASSWORD in .env"**: the `.env` file is missing or not in the `chemtech-erp` folder.
- **"DEMO_SEED=1 needs DEMO_PASSWORD"**: add `DEMO_PASSWORD=…` to `.env`.
- **Port 3000 is already in use**: change `"3000:3000"` to `"3001:3000"` in `docker-compose.yml` and open http://localhost:3001.
- **Sign-in seems to do nothing**: use `http://localhost:3000` exactly. The cookie setting for plain HTTP is meant for your own machine. For a server shared with colleagues, follow [DEPLOYMENT.md](DEPLOYMENT.md) and use HTTPS.
