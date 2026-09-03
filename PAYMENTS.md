# BuyMeSoda Payment Architecture

BuyMeSoda treats a supporter payment as **pending** until the payment provider confirms that money was actually received. A browser redirect, success page, button click, or QR scan is not payment confirmation.

## Transaction lifecycle

1. Supporter chooses a soda amount and submits optional name/email/message.
2. BuyMeSoda creates a transaction with a unique internal reference such as `SODA-...`.
3. The transaction starts as `pending`.
4. A payment provider creates or processes the payment.
5. The provider sends a verified server-to-server callback/webhook.
6. BuyMeSoda matches the provider event to the transaction using the provider reference and/or internal reference.
7. Only after successful verification does the transaction become `completed` and contribute to creator earnings.
8. Reversals/refunds/failed payments must move the transaction to an appropriate non-earned state.

## Provider-neutral fields

The transaction stores:

- `provider` — `paypal`, `mpesa`, `paymongo`, `gcash`, etc.
- `providerReference` — the provider's order/payment/receipt ID.
- `status` — for example `pending`, `completed`, `cancelled`, `refunded`.
- `amount` and `currency` — the gross supporter amount.
- `feeAmount` — provider/platform fee once known.
- `netAmount` — amount available to the creator after applicable fees.
- `reference` — BuyMeSoda's own unique transaction reference.
- `completedAt` — timestamp of confirmed completion.

## PayPal

For a real API-controlled PayPal checkout, use PayPal Checkout/Orders rather than treating a PayPal.Me redirect as proof of payment. PayPal's webhook events are the authoritative server-side confirmation path for payment state changes.

The current `paypalMe` field is retained for the existing simple flow. It should stay marked pending until a future provider integration can verify payment.

## M-Pesa / other providers

The same transaction model is intended to support an M-Pesa STK Push or other provider adapter. Each adapter should create the pending transaction first, store the provider reference, verify the provider callback, and then update the transaction atomically.

## Credentials

Keep all provider credentials in hosting environment variables or a secret manager. Never commit real client secrets, consumer secrets, passkeys, webhook secrets, or private keys to GitHub.
