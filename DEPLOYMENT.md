# BuyMeSoda deployment checklist

The rebuild branch is designed to run as a Node.js/Express application with Prisma.

## Required environment variables

Set these in the hosting provider's server environment, not in GitHub:

- `NODE_ENV=production`
- `PORT` (usually supplied by the host)
- `SESSION_SECRET`
- `ADMIN_PASSWORD`
- `PAYMENT_WEBHOOK_SECRET`
- SMTP variables for contact and password reset email
- Payment-provider variables when enabling M-Pesa or PayPal

## Database

The current rebuild schema uses SQLite for development. Before public production launch, move the Prisma datasource to a managed PostgreSQL database and configure the corresponding `DATABASE_URL`.

Do not treat a local `dev.db` file as production storage.

## Files / uploads

Profile pictures currently use a local `uploads/profile-pictures` directory. On hosts with ephemeral filesystems, move image storage to persistent object storage before launch.

## Payment activation

Do not mark a transaction completed because a supporter was redirected to a payment page. Only a verified provider callback/webhook should transition a transaction to `completed`.

For M-Pesa, configure the Daraja callback URL to the public HTTPS endpoint used by the provider adapter. Test in sandbox before enabling production credentials.

## Launch sequence

1. Deploy the rebuild branch to a staging URL.
2. Create the production database and run Prisma schema deployment.
3. Configure SMTP and verify password reset/contact email.
4. Create a creator account and test the public supporter flow.
5. Test payment callbacks in sandbox.
6. Test creator balance and withdrawal-request flows.
7. Test admin suspension and transaction monitoring.
8. Confirm HTTPS, secure cookies, environment variables, backups, and persistent file storage.
9. Only then promote the tested build to the live domain.
