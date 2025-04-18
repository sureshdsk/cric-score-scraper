# Cricket Score Scraper

A Cloudflare Worker that scrapes cricket match data every 15 minutes between 7:30 PM IST and 12:00 AM IST. The worker collects information about dot balls bowled and played by players.

## Prerequisites

- Node.js (v16 or later)
- npm
- Cloudflare account with Workers enabled

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure your Cloudflare account:
   ```bash
   npx wrangler login
   ```

3. Update the match URL in `src/index.ts` with your target URL.

## Development

To run the worker locally:
```bash
npm run dev
```

## Deployment

To deploy the worker to Cloudflare:
```bash
npm run deploy
```

## Project Structure

- `src/index.ts`: Main worker code that handles scraping logic
- `wrangler.toml`: Cloudflare Worker configuration
- `tsconfig.json`: TypeScript configuration

## Cron Schedule

The worker runs every 15 minutes between 7:30 PM and 12:00 AM IST (UTC+5:30). This is configured in the `wrangler.toml` file. 



npx wrangler d1 create ipl2025

npx wrangler d1 execute ipl2025 --local --file=./schema.sql


npx wrangler d1 execute ipl2025 --local --command="SELECT * FROM Teams"



npx wrangler d1 execute ipl2025 --remote --file=./schema.sql
npx wrangler deploy