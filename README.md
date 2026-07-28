# shittymail

A self-hosted email API for your websites and applications — built as an alternative to services like Resend.

## What is shittymail?

**shittymail** is a custom mail-sending API that lets your websites and applications send emails through a simple HTTP API.

Instead of integrating a third-party email API, you can run your own shittymail server and send emails through endpoints like:

```bash
curl -X POST http://localhost:3000/v1/emails \
  -H "Authorization: Bearer re_test_123" \
  -H "Content-Type: application/json" \
  -d '{
    "from": "hello@anomalyon.top",
    "to": "you@example.com",
    "subject": "Hello from shittymail",
    "html": "<h1>Hello!</h1><p>This email was sent with shittymail.</p>"
  }'
```

## Tech Stack

* **TypeScript**
* **Node.js**
* **Fastify**
* **Nodemailer**
* **SMTP Server**
* **Zod**
* **dotenv**

## Installation

Clone the repository:

```bash
git clone https://github.com/yourusername/shittymail.git
cd shittymail
```

Install dependencies:

```bash
npm install
```

## Configuration

Create a `.env` file:

```env
port=3000

smtp_host=127.0.0.1
smtp_port=2525
smtp_user=anomaly
smtp_password=anomaly@local

api_key=re_test_123

mail_domain=anomalyon.top

smtp_listen_host=127.0.0.1
api_listen_host=0.0.0.0
```

Never commit your `.env` file.

Add it to `.gitignore`:

```gitignore
.env
node_modules
dist
```

## Development

Run the TypeScript compiler check:

```bash
npx tsc --noEmit
```

Start the development server:

```bash
npm run dev
```

You should see:

```text
shittymail is running on http://localhost:3000
smtp server is running on port 2525
```

## API

### `GET /`

Returns basic information about the server.

```bash
curl http://localhost:3000/
```

Response:

```json
{
  "message": "shittymail is running!"
}
```

### `GET /health`

Health check for monitoring and deployments.

```bash
curl http://localhost:3000/health
```

Response:

```json
{
  "status": "ok"
}
```

### `POST /v1/emails`

Send an email.

#### Headers

```http
Authorization: Bearer re_test_123
Content-Type: application/json
```

#### Request

```json
{
  "from": "hello@anomalyon.top",
  "to": "you@example.com",
  "subject": "Hello!",
  "html": "<h1>Hello!</h1><p>This is a test.</p>"
}
```

#### Example

```bash
curl -X POST http://localhost:3000/v1/emails \
  -H "Authorization: Bearer re_test_123" \
  -H "Content-Type: application/json" \
  -d '{
    "from": "hello@anomalyon.top",
    "to": "you@example.com",
    "subject": "Hello from shittymail",
    "html": "<h1>Hello!</h1><p>This was sent through shittymail.</p>"
  }'
```

#### Successful response

```json
{
  "id": "<message-id@anomalyon.top>",
  "message": "email sent successfully"
}
```

## Roadmap

* [x] Fastify API
* [x] API key authentication
* [x] Email request validation
* [x] HTML email support
* [x] Plain-text email support
* [x] SMTP server
* [x] Environment configuration
* [ ] Real outbound SMTP delivery
* [ ] MX record lookup
* [ ] Custom domain verification
* [ ] SPF support
* [ ] DKIM signing
* [ ] DMARC support
* [ ] Email delivery tracking
* [ ] Bounce handling
* [ ] Rate limiting
* [ ] API key management
* [ ] Dashboard
* [ ] Usage statistics
* [ ] Production deployment guide

## Project Structure

```text
shittymail/
├── src/
│   └── index.ts
├── .env
├── .gitignore
├── package.json
├── package-lock.json
└── tsconfig.json
```

## Security

Do not expose your SMTP credentials or API keys publicly.

Do not commit `.env` to Git.

For production deployments, use:

* TLS
* Secure API keys
* SPF
* DKIM
* DMARC
* Rate limiting
* Proper SMTP authentication
* Reverse DNS/PTR configuration

The current local SMTP configuration is intended for development and testing.

## Why shittymail?

Because why pay for an email API when you can make your own?

shittymail aims to provide a simple, self-hosted alternative to hosted email APIs while giving developers control over their infrastructure, domains, and email delivery.

## License

Add your preferred license here.

---

Built with TypeScript because apparently we needed another email API.
