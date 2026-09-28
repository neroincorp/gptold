# ClassicChat

A responsive retro AI chat interface inspired by early 2022–2023 chat UIs, with its own branding.

## Run locally

1. Install Node.js 18 or newer.
2. In this folder, run `npm install`.
3. Copy `.env.example` to `.env`.
4. Put your OpenAI API key in `.env` as `OPENAI_API_KEY=...`.
5. Run `npm start`.
6. Open `http://localhost:3000`.

The API key stays on the server and is never sent to the browser.

## Public deployment notes

The included per-IP daily limit is only a starter. It is stored in memory and resets whenever the server restarts. Before advertising the site publicly, move quotas to Redis or a database, add account/email verification or a challenge for suspicious traffic, and set an API budget/usage alert.

## Model

The server currently requests `gpt-3.5-turbo` through OpenAI's Chat Completions endpoint.

## Branding

The interface intentionally uses its own `ClassicChat` name and an `AI` avatar instead of OpenAI/ChatGPT logos so a public deployment does not look like an official OpenAI product.
