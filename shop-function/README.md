# polymath-shop: card payments for /products

Card payments on polymathlc.com.sg/products go through **Stripe Checkout**, on the
Polymath Stripe account `acct_1EdAmjA59UOU3oHi`. PayNow keeps working exactly as
before; "Pay by card" sits next to it.

## How a card order flows

1. The parent fills in their details and taps **Pay by card**. The page posts the
   cart (product ids and quantities only) to `createShopCheckout`.
2. The function prices every line again from `shop_products`, refuses anything
   hidden, sold out or short of stock (the page then refreshes the cart and says
   which line changed), adds `shop_settings/config.deliveryFee` once on delivery
   orders, saves the checkout in `shop_checkouts/{code}` under a new 6-character
   order code, and opens a Stripe Checkout Session (SGD, card only, 1 hour).
3. The parent pays on Stripe's page and is sent back to
   `/products/?order=CODE&session=cs_…`. The page asks `shopCheckoutStatus`,
   which checks with Stripe and, once paid, writes the order.
4. Stripe also calls `stripeShopWebhook` (`checkout.session.completed`). The
   signature is checked against `STRIPE_WEBHOOK_SECRET`, then the order is
   written the same way. This covers a parent who closes the tab after paying.

Steps 3 and 4 share one idempotent transaction: whichever comes first creates
`shop_orders/{code}` with `status: 'paid'`, `payment: 'card'` and the Stripe ids,
and takes the stock out exactly like the admin's **Mark paid** (unlimited stock is
left alone, counts never go below zero, `stockApplied: true` so **Cancel order**
puts it back). The other is a no-op. If stock ran out between checkout and payment
the order lists it in `stockShort`; an unexpected amount is listed in
`paymentChecks`. The admin page shows both.

Refunds are done in the Stripe dashboard. Cancelling a card order on the admin page
only puts the stock back.

## Switching it on (no terminal needed)

1. **GitHub secrets** (cer → Settings → Secrets and variables → Actions):
   - `STRIPE_SECRET_KEY`: Stripe → Developers → API keys → Secret key (`sk_live_…`).
   - `STRIPE_WEBHOOK_SECRET`: see step 2.
   - `FIREBASE_SERVICE_ACCOUNT` is already there for the enquiry service.
2. **Stripe webhook** (Stripe → Developers → Webhooks → Add endpoint):
   - URL: `https://us-central1-mathgen--app.cloudfunctions.net/stripeShopWebhook`
   - Events: `checkout.session.completed` and `checkout.session.async_payment_succeeded`
   - Copy its Signing secret (`whsec_…`) into `STRIPE_WEBHOOK_SECRET`.
3. **Deploy**: Actions → *Deploy shop card payments* → Run workflow. The run
   checks the key belongs to `acct_1EdAmjA59UOU3oHi`, deploys, and proves the
   live endpoints answer. Until `STRIPE_SECRET_KEY` exists it skips the deploy
   and says so, and the page shows card payment as unavailable, offering PayNow.

## Firestore

The functions use the Admin SDK, so `shop_checkouts` and `shop_checkout_limits`
need **no** rule; leave them unreadable to the public (the default). Nothing in the
existing console rules has to change. The daily `cleanupShopCheckouts` removes
checkouts a week old and expired rate-limit counters; orders are never touched.

## Files

- `functions/stripe.js`: Stripe REST calls with `fetch` (no SDK) and webhook signature checks.
- `functions/service.js`: validation, pricing and the three HTTP handlers.
- `functions/repository.js`: Firestore reads and the transactions.
- `functions/test/shop.test.js`: `npm test` (no network, no Firebase).
- `../tools/shop-deploy-setup.mjs`, `../tools/shop-smoke.mjs`, `../tools/shop-deploy-tests.mjs`.
- `../.github/workflows/deploy-shop.yml`.
