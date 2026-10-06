# Furniture8home backend

The shop backend for the [furniture8home-frontend](https://github.com/imrituraj/furniture8home-frontend) storefront, running as one Cloudflare Worker:

| Path | What it serves |
| --- | --- |
| `/api/*` | Shop API: products, categories, checkout, Razorpay payments and webhook, admin endpoints |
| `/media/*` | Photos uploaded from the admin dashboard |
| everything else | The admin dashboard (React, in `admin/`) |

Data lives in a **Cloudflare D1** database (SQLite). On first use the Worker creates its tables and loads the starter catalog from `seed/`, so a new database needs no setup.

## Layout

| Path | What it is |
| --- | --- |
| `src/index.js` | Routes, CORS for the storefront, payment flow |
| `src/catalog.js`, `src/categories.js`, `src/orders.js` | Validation and storage for each kind of data |
| `src/razorpay.js` | Razorpay orders, payment and webhook signature checks |
| `src/auth.js` | Admin PIN login, sessions, rate limits |
| `src/media.js` | Stores and serves uploaded photos |
| `src/schema.js`, `src/seed.js` | Database tables and the first-run starter catalog |
| `seed/` | Starter products and categories (also used by "Reset catalog") |
| `admin/` | The admin dashboard: Orders, Products and Categories tabs |

## Safety

- Prices are always recalculated on the server from the catalog; the client's prices are ignored.
- Online orders are marked paid only after the Razorpay signature is verified **and** Razorpay confirms the payment is for this order and the full amount, or a signed webhook arrives.
- Customers can only see or update their own order, using a secret returned at checkout.
- Admin login is a 6–8 digit PIN (the `ADMIN_PIN` secret). Wrong PINs are rate-limited per device and site-wide. Sessions last 12 hours.
- The public API only answers browsers on the domains in `STOREFRONT_ORIGIN`.

## Develop

```bash
npm install     # installs wrangler and the admin dashboard
npm run dev     # Worker + admin on http://localhost:8787, with a local D1 database
```

Locally the admin PIN is `8888`, and online payment is hidden until Razorpay keys are set. To test payments locally, put test-mode keys in a `.dev.vars` file (gitignored):

```
RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=...
```

Run the storefront repo's `npm run dev` alongside to try the whole shop; it forwards `/api` to port 8787. `npm run dev:admin` runs the admin with hot reload on port 5173 instead.

## Deploy on Cloudflare

1. **Connect the repo.** In the Cloudflare dashboard go to Workers & Pages → Create → Import a repository, and pick `furniture8home-backend`. Keep the default deploy command (`npx wrangler deploy`). Wrangler builds the admin and creates the `furniture8home` D1 database on the first deploy.
2. **Set secrets.** In the Worker's Settings → Variables and Secrets, add:

   | Secret | Value |
   | --- | --- |
   | `ADMIN_PIN` | 6–8 digits. Admin login is refused until this is set. |
   | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | From Razorpay Dashboard → Account & Settings → API Keys. Use test-mode keys first. |
   | `RAZORPAY_WEBHOOK_SECRET` | Optional, see step 4. |

3. **Check the allowed storefront domains.** `STOREFRONT_ORIGIN` in `wrangler.jsonc` lists the sites that may call the API (`https://furniture8home.com` and `https://www.furniture8home.com`). Add your Vercel preview domain while testing, then redeploy.
4. **Razorpay webhook (recommended).** In Razorpay, add a webhook to `https://<backend>/api/razorpay/webhook` with the events `order.paid`, `payment.captured` and `payment.failed`, and save its secret as `RAZORPAY_WEBHOOK_SECRET`. This marks orders paid even if the customer closes the page right after paying.
5. **Point the storefront at the backend.** In Vercel, set `VITE_API_URL` to this Worker's URL and redeploy the storefront.

The admin dashboard is then at the Worker's URL. Its storefront links (image previews, "View Store") point at `https://furniture8home.com`; to use another domain, set `VITE_STOREFRONT_URL` as a build variable in Cloudflare (Settings → Build → Variables).
