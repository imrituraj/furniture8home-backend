# Furniture8home backend

The shop API for the [furniture8home-frontend](https://github.com/imrituraj/furniture8home-frontend) storefront and admin dashboard, running as a Cloudflare Worker. It has no pages of its own; the storefront (`furniture8home.com`) and the admin (`admin.furniture8home.com`) are hosted on Vercel.

| Path | What it serves |
| --- | --- |
| `/api/products`, `/api/categories`, `/api/config` | Catalog and checkout settings for the storefront |
| `/api/orders/*` | Checkout and Razorpay payment verification |
| `/api/razorpay/webhook` | Razorpay payment notifications |
| `/api/admin/*` | Admin login, orders, products and categories |
| `/media/*` | Photos uploaded from the admin dashboard |

Data lives in a **Cloudflare D1** database (SQLite). On first use the Worker creates its tables and loads the starter catalog from `seed/`, so a new database needs no setup.

## Order emails

The Worker emails from **Furniture8home@gmail.com** through Gmail's mail server (`src/mail.js`, templates in `src/emails.js`). Emails go out in the background, so a Gmail problem never slows down or breaks checkout; failures are logged in the Worker's logs.

| When | Shop (Furniture8home@gmail.com) | Customer (if they gave an email) |
| --- | --- | --- |
| Offline / WhatsApp order placed | New-order alert | Order confirmation |
| Razorpay payment confirmed | New **paid** order alert | Confirmation + payment received |
| Admin marks payment Paid | — | Payment received |
| Admin sets Confirmed / Out for delivery / Delivered | — | Status update |

Online orders only alert the shop once paid, so abandoned payments don't send anything. Customers can reply to any email to reach the shop; replying to a new-order alert reaches the customer.

**Turning it on:** emails stay off until the `GMAIL_APP_PASSWORD` secret is set.

1. Sign in to the Furniture8home@gmail.com Google account and turn on **2-Step Verification** (Google Account → Security).
2. Open https://myaccount.google.com/apppasswords, create an app password named "Furniture8home shop", and copy the 16-character password.
3. In Cloudflare, add it to the Worker as the secret `GMAIL_APP_PASSWORD` (Settings → Variables and Secrets → Add → Secret).

Gmail allows about 500 emails a day from one account. If the shop outgrows that, switch to a sending service.

## Layout

| Path | What it is |
| --- | --- |
| `src/index.js` | Routes, cross-site access rules, payment flow |
| `src/catalog.js`, `src/categories.js`, `src/orders.js` | Validation and storage for each kind of data |
| `src/razorpay.js` | Razorpay orders, payment and webhook signature checks |
| `src/auth.js` | Admin PIN login, sessions, rate limits |
| `src/mail.js`, `src/emails.js` | Sending through Gmail, and the order email templates and rules |
| `src/media.js` | Stores and serves uploaded photos |
| `src/schema.js`, `src/seed.js` | Database tables and the first-run starter catalog |
| `seed/` | Starter products and categories (also used by "Restore Factory Catalog") |

## Safety

- Prices are always recalculated on the server from the catalog; the client's prices are ignored.
- Online orders are marked paid only after the Razorpay signature is verified **and** Razorpay confirms the payment is for this order and the full amount, or a signed webhook arrives.
- Customers can only see or update their own order, using a secret returned at checkout.
- Admin login is a 6–8 digit PIN (the `ADMIN_PIN` secret). Wrong PINs are rate-limited per device and site-wide. Sessions last 12 hours and use a bearer token, not cookies.
- Browsers may only call the public API from `STOREFRONT_ORIGIN` (and the admin), and the admin API only from `ADMIN_ORIGIN`.

## Develop

```bash
npm install     # installs wrangler
npm run dev     # API on http://localhost:8787 with a local D1 database
```

Locally the admin PIN is `8888`, the storefront (port 5173) and admin (port 5174) from the frontend repo are allowed, and online payment is hidden until Razorpay keys are set. To test payments, put test-mode keys in a `.dev.vars` file (gitignored):

```
RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=...
```

## Deploy on Cloudflare

The Worker is connected to this repo in Cloudflare (Workers & Pages → `furniture8home-backend`), so every push to `main` deploys it. Wrangler created the `furniture8home` D1 database on the first deploy.

1. **Secrets.** In the Worker's Settings → Variables and Secrets, add:

   | Secret | Value |
   | --- | --- |
   | `ADMIN_PIN` | 6–8 digits. Admin login is refused until this is set. |
   | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | From Razorpay Dashboard → Account & Settings → API Keys. Use test-mode keys first. |
   | `RAZORPAY_WEBHOOK_SECRET` | Optional, see step 3. |
   | `GMAIL_APP_PASSWORD` | Turns on order emails, see [Order emails](#order-emails). |

2. **Allowed sites.** `STOREFRONT_ORIGIN` and `ADMIN_ORIGIN` in `wrangler.jsonc` list the domains that may call the API. Add a Vercel preview domain while testing, then push.
3. **Razorpay webhook (recommended).** In Razorpay, add a webhook to `https://<backend>/api/razorpay/webhook` with the events `order.paid`, `payment.captured` and `payment.failed`, and save its secret as `RAZORPAY_WEBHOOK_SECRET`. This marks orders paid even if the customer closes the page right after paying.
