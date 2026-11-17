// Stripe client. The second In2Skin Stripe account does not exist yet — the
// code reads STRIPE_SECRET_KEY from the environment and fails gracefully
// with a clear message when it is unset. Never commit a real key.
let stripe = null;

function getStripe() {
  if (stripe) return stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    const e = new Error(
      "Stripe is not configured yet: set STRIPE_SECRET_KEY (and STRIPE_WEBHOOK_SECRET) " +
      "in the Vercel project settings, then redeploy."
    );
    e.code = "STRIPE_NOT_CONFIGURED";
    e.status = 503;
    throw e;
  }
  stripe = require("stripe")(key);
  return stripe;
}

module.exports = { getStripe };
