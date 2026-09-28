# ClassicChat

A retro, early-ChatGPT-inspired chat interface with a Node/Express backend.

## Models

The built-in model picker supports:
- `gpt-3.5-turbo`
- `gpt-5-nano`

## Setup

1. Run `npm install`.
2. Put your OpenAI API key in `.env`:
   `OPENAI_API_KEY=your_key_here`
3. Set the daily quota if desired:
   `DAILY_MESSAGE_LIMIT=30`
4. Run `npm start`.
5. Open `http://localhost:3000`.

Never put your API key in `index.html` or `app.js`, and do not commit `.env` publicly.

## Usage quota

The included quota is a starter per-IP daily limiter. The browser meter is protected against stale requests that could make the visible count jump backward/forward. For a larger public deployment or multiple server instances, move the quota store to Redis or another persistent database.
