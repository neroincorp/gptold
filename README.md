# ClassicChat

A retro, early-ChatGPT-inspired chat interface with a Node/Express backend.

## Models

The built-in model picker currently allows:
- `gpt-3.5-turbo`

`GPT-6 Astra` is shown in the selector as a disabled “Coming soon” option.

## Setup

1. Run `npm install`.
2. Put your OpenAI API key in `.env`:
   `OPENAI_API_KEY=your_key_here`
3. The included quota defaults to 10 messages every 3 hours:
   `MESSAGE_LIMIT=10`
   `LIMIT_WINDOW_HOURS=3`
4. Run `npm start`.
5. Open `http://localhost:3000`.

Never put your API key in `index.html` or `app.js`, and do not commit `.env` publicly.

## Usage quota

The included quota is a starter per-IP fixed-window limiter. Each visitor gets 10 messages in a 3-hour window, with a live countdown in the UI. The browser meter rejects stale same-window refreshes so the visible count does not jump backward and forward. For a larger public deployment or multiple server instances, move the quota store to Redis or another persistent database.


## Usage limit persistence
The 10-message / 3-hour quota is stored in a signed HttpOnly cookie as well as server memory, so the current window survives normal server restarts and redeploys for the same browser. For strong cross-device/IP enforcement at scale, use Redis or a database.
