# polymath-shop: card payments for /products

Card payments on polymathlc.com.sg/products go through **Stripe Checkout**, on the
Polymath Stripe account `acct_1USg162dM5Vps1NT`. PayNow keeps working exactly as
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

## Receipt emails

Every paid order gets a receipt email from **Polymath Learning Centre
<admin@polymathlc.com.sg>** (replies go to that inbox), composed on the server by
`functions/receipt.js` and written to the `mail` collection, which the project's
Trigger Email extension sends, the same way Polymath Online invitations go out.

- **Card:** written in the same transaction that records the paid order, so it
  goes out exactly once (`mail/polymath-shop-receipt-CODE-1`).
- **PayNow:** when the admin presses **Mark paid**, the page calls
  `sendShopReceipt` with the admin's Google sign-in; the function checks the
  token belongs to `chungzhikai@gmail.com` before sending.
- **Resend:** the **Email receipt / Resend receipt** button on any paid or collected
  order (at most one a minute per order). The order keeps `receiptCount`,
  `receiptSentAt` and `receiptSentTo`.

Email is required at checkout; PayNow orders placed before v1.3.2 may have none,
and the button is hidden for them.

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
   checks the key belongs to `acct_1USg162dM5Vps1NT`, deploys, and proves the
   live endpoints answer. Until `STRIPE_SECRET_KEY` exists it skips the deploy
   and says so, and the page shows card payment as unavailable, offering PayNow.

## Trial lessons and enrolments on /schedule

The booking form on polymathlc.com.sg/schedule offers **Pay by card** (first) next to
PayNow, through the same Stripe account, keys and webhook. Nothing new is needed in
Stripe or in the GitHub secrets.

1. The parent fills in the form and taps **Pay $X by card**. The page posts the
   class (slot id), trial or enrol, how the child attends and the parent's details
   to `createScheduleCheckout`. No price is sent.
2. The function prices it from `schedule_config/main` with the page's own rules
   (`functions/booking.js`: Online and Physical prices, the Master Class, a slot's
   own fee first), refuses a class that is full, closed or has no price, saves the
   checkout in `shop_checkouts/{code}` (`kind: 'booking'`) and opens a Stripe
   Checkout Session marked `metadata.source: 'polymath-schedule'`.
3. Stripe sends the parent back to `/schedule/?booking=CODE&session=cs_…`; the page
   asks `scheduleCheckoutStatus`. Stripe's webhook (`stripeShopWebhook`) hands the
   same session to the booking code too, so closing the tab after paying is fine.
4. Either way, one transaction writes `schedule_bookings/{code}` in the shape a
   PayNow booking has, with `payment: 'card'`, `paid: true` and the Stripe ids
   (status stays `pending` until the admin confirms the date), and emails the
   centre and the parent (`functions/booking-mail.js`) exactly once.

The products page's **Hide card payment** switch (`shop_settings/config.cardPayments`)
hides card payment on the booking form too, and the server refuses it.

## Firestore

The functions use the Admin SDK, so `shop_checkouts` and `shop_checkout_limits`
need **no** rule; leave them unreadable to the public (the default). Nothing in the
existing console rules has to change. `createShopCheckout` also sweeps away
checkouts a week old and expired rate-limit counters, at most once an hour and a
few pages at a time; orders are never touched. (This is not a scheduled function
because the deploy account cannot manage Cloud Scheduler jobs.)

## Files

- `functions/stripe.js`: Stripe REST calls with `fetch` (no SDK) and webhook signature checks.
- `functions/service.js`: validation, pricing and the four HTTP handlers.
- `functions/receipt.js`: the receipt email (text and HTML).
- `functions/booking.js`, `functions/booking-mail.js`: card-paid trials and enrolments on /schedule, and their emails.
- `functions/test/booking.test.js`: the booking tests (`npm test` runs both).
- `functions/repository.js`: Firestore reads and the transactions.
- `functions/test/shop.test.js`: `npm test` (no network, no Firebase).
- `../tools/shop-deploy-setup.mjs`, `../tools/shop-smoke.mjs`, `../tools/shop-deploy-tests.mjs`.
- `../.github/workflows/deploy-shop.yml`.
