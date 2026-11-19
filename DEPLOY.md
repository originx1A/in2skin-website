# In2Skin — deploy guide (parent browser steps)

The repo is complete and pushed. **Nothing is deployed or live yet.** These
steps need a browser (Vercel dashboard, Stripe, DNS). Do them in order.

## 0. Pre-launch checklist (before the site goes live)

- [ ] **Phone number:** the site currently shows the preview placeholder
      **(905) 555-0148**. Swap it for the live call-tracking number before
      go-live. Tony's Nov 17 ruling: use the Ringbreeze number
      **289-212-4124** if still active, forwarded to Sarah's phone — its
      status is UNVERIFIED (Retell wiring never finished; account holder
      email unknown). The number lives in one place in `index.html`
      (`PHONE_DISPLAY` / `PHONE_TEL` + the header link) and in the generated
      service pages + `llms.txt` + JSON-LD — search the repo for `555-0148`
      and replace every occurrence, then re-run `npm run build:pages`.
- [ ] **Chemical Peels online price:** a peel books online at the **$95
      starting price** (the preview's `priceNum`); the exact price ($95–$475)
      is confirmed at consultation and any balance is settled at the visit.
      Confirm Tony is happy with that, or set a different online price.

## 1. Environment variables

Set these in the Vercel project settings (Production + Preview). Template:
`.env.example`. **Never commit real values.**

| Variable | What provides it | Exists yet? |
|---|---|---|
| `STRIPE_SECRET_KEY` | Second In2Skin Stripe account — create it in the Stripe dashboard (a NEW account, separate from any existing one), then copy its secret key. Use test keys first, live keys at go-live. | **NO — account does not exist yet** |
| `STRIPE_WEBHOOK_SECRET` | In the same Stripe account: Developers → Webhooks → add endpoint `https://boltonfacials.com/api/stripe-webhook`, subscribe to `checkout.session.completed`. Copy the signing secret. | **NO** |
| `KV_REST_API_URL` | Vercel dashboard → Storage → Create Database → KV (Upstash Redis). The dashboard shows the REST URL + token after creation. | **NO — KV not provisioned yet** |
| `KV_REST_API_TOKEN` | Same as above. | **NO** |
| `RESEND_API_KEY` | Resend dashboard (free tier) → API Keys → create one. | **NO — key not created yet** |
| `EMAIL_FROM` | Optional. Default is `In2Skin <bookings@boltonfacials.com>`. | n/a (has default) |
| `SITE_URL` | Optional. Default is `https://boltonfacials.com`. | n/a (has default) |
| `ADMIN_EMAIL` | The studio emails that receive admin magic links — comma-separated list (Tony's + Sarah's). | **NO — value not chosen yet** |
| `ADMIN_PASSWORD` | Password for admin login (the alternative to magic links). Choose a strong one; store it in the Secure Vault, not in chat. | **NO — value not chosen yet** |

Until the KV, Stripe and Resend keys are set, the API endpoints return a
clear 503 explaining exactly which variable is missing — the static site
still loads and the booking wizard falls back to showing all times.

## 2. Vercel project (browser steps)

1. In Vercel, link the GitHub repo **`originx1A/in2skin-website`** (Import
   Project → GitHub). Framework preset: **Other** (static + serverless, no
   framework). Root directory: repo root. No build command needed.
2. Add the environment variables from §1 (Production + Preview).
3. Provision **KV** (Storage → Create Database → KV) and confirm the
   `KV_REST_API_URL` / `KV_REST_API_TOKEN` variables are attached to the
   project.
4. Deploy. Confirm the deploy is green and `https://<project>.vercel.app/`
   loads.
5. In the Stripe account, add the webhook endpoint (§1) pointing at the
   **production** domain (after DNS, §3) — or temporarily at the
   `vercel.app` URL for testing, then move it.

## 3. DNS (do NOT touch until the Vercel deploy is green)

1. In Vercel → project → Settings → Domains → add **`boltonfacials.com`**
   (and `www.boltonfacials.com` if wanted). Vercel will show the DNS records.
2. At the domain registrar (where boltonfacials.com lives — bought Nov 17,
   Order ID 12596102), add the records Vercel shows (A / CNAME).
3. Domain email routing for `bookings@boltonfacials.com` (the Resend sender)
   is a later DNS step: verify the domain in Resend and add its DKIM/SPF
   records. Until then, Resend will send from its default domain or fail —
   test email delivery after this step.
4. Wait for DNS to propagate, then confirm https://boltonfacials.com loads.

## 4. Stripe test pass (before go-live, with test keys)

1. Book a Classic Facial with a Stripe test card (4242 4242 4242 4242) —
   confirm the Checkout page shows the right amount, the IN2SKIN descriptor,
   and the confirmation page + email arrive.
2. Buy a $65 gift certificate — confirm the code page shows the code and the
   recipient email arrives; check the balance at `/api/gift-balance?code=…`.
3. Book again using that gift code — confirm the balance comes off and the
   remainder stays on the code.
4. Pay on the spot: create a link from the homepage Pay section, open it on
   a phone, pay with a test card — confirm the receipt. After paying, Stripe
   redirects to pay-paid.html, which confirms the payment through
   GET /api/pay?session_id= even if the webhook never fires (Nov 17: the
   webhook was never invoked for a test payment — the redirect is the
   fallback, the webhook stays the primary path when it delivers).
5. Admin: request a magic link, sign in, confirm today's payments and the
   calendar show the test bookings; sign out and back in (session persists).
6. Confirm the webhook in Stripe shows `checkout.session.completed` → 200.
7. Switch the Stripe keys to **live** keys, re-test with a real $1 payment
   (or a live gift purchase you refund), then go live.

## 5. After go-live

- Test the live booking flow end-to-end once more with a real card.
- Check Google Search Console / sitemap (`/sitemap.xml`).
- Swap the placeholder phone number (§0) if it has not been done already.
- SMS for pay-on-the-spot is NOT wired (Resend is email-only). If Tony wants
  automatic texting, that needs a text provider (e.g. Twilio) — a follow-up
  task, not part of this build.
