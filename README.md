# HSSP Media Official

A student-led photography and videography production company serving the Dallas-Fort Worth metroplex. This is the official website backend and frontend for HSSP Media.

## Features

- **Portfolio Showcase** — Real estate, celebrations, weddings, graduations, culinary & cultural events
- **Service Inquiries** — Clients can request specific services with preferred dates and budgets
- **Contact Forms** — General inquiries and newsletter signups
- **Real-time Notifications** — Email + Discord alerts for new inquiries
- **Admin Dashboard** — View and manage all inquiries

## Tech Stack

- **Backend**: Node.js + Express
- **Database**: SQLite
- **Frontend**: HTML5 + CSS3 + Vanilla JavaScript
- **Notifications**: Email (Nodemailer) + Discord Webhooks

## Setup

### Prerequisites
- Node.js 18+
- npm

### Installation

1. **Clone the repo**
   ```bash
   git clone https://github.com/yourusername/HSSP-Media-Official.git
   cd HSSP-Media-Official
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` with your configuration:
   - `ADMIN_KEY` — Random secret for admin endpoints
   - `SMTP_*` — Gmail credentials for email notifications
   - `DISCORD_WEBHOOK_URL` — Discord webhook for instant alerts
   - `NOTIFY_EMAIL` — Email to receive notifications

4. **Start the server**
   ```bash
   npm run dev      # Development with auto-reload
   npm start        # Production
   ```

   Server runs at `http://localhost:3000`

## API Endpoints

### Public

- `POST /api/contact` — General contact form submission
- `POST /api/inquiry` — Service inquiry with budget & date
- `POST /api/newsletter` — Newsletter signup
- `GET /api/health` — Health check

### Admin (requires `x-admin-key` header)

- `GET /api/admin/contacts` — View all contacts
- `GET /api/admin/inquiries` — View all inquiries
- `GET /api/admin/newsletter` — View newsletter subscribers
- `PATCH /api/admin/inquiries/:id` — Update inquiry status

## Notifications

### Email Notifications
1. Get a Gmail account
2. Enable 2FA and [create an app password](https://myaccount.google.com/apppasswords)
3. Add to `.env`:
   ```
   SMTP_USER=your-email@gmail.com
   SMTP_PASS=xxxx xxxx xxxx xxxx
   ```

### Discord Notifications (Free!)
1. Create a Discord server
2. Create a webhook in any channel
3. Copy webhook URL to `.env`:
   ```
   DISCORD_WEBHOOK_URL=https://discordapp.com/api/webhooks/...
   ```

## Development

Run with auto-reload:
```bash
npm run dev
```

## Deployment

Recommended hosting services:
- **Vercel** (free tier, optimized for Node.js)
- **Render** (free tier with auto-deploy from GitHub)
- **Railway** (free tier with generous credits)

## License

© 2026 HSSP Media. All rights reserved.
