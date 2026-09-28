import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
const PORT = process.env.PORT || 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.set('trust proxy', 1);
app.use(express.json({ limit: '200kb' }));
app.use(express.static(__dirname));

// Starter abuse protection. Each IP gets a fixed usage window that starts
// when that visitor first loads/uses the site. For a larger public deployment,
// move this store to Redis / a database so limits survive redeploys and can be
// shared across multiple server instances.
const usageWindows = new Map();
const MESSAGE_LIMIT = Math.max(1, Number(process.env.MESSAGE_LIMIT || 10));
const LIMIT_WINDOW_HOURS = Math.max(1, Number(process.env.LIMIT_WINDOW_HOURS || 3));
const LIMIT_WINDOW_MS = LIMIT_WINDOW_HOURS * 60 * 60 * 1000;
const ALLOWED_MODELS = new Set(['gpt-3.5-turbo']);

function stableClientIp(req) {
  const forwarded = req.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function getUsageWindow(req) {
  const key = stableClientIp(req);
  const now = Date.now();
  let state = usageWindows.get(key);

  if (!state || !Number.isFinite(state.resetAt) || now >= state.resetAt) {
    state = {
      used: 0,
      resetAt: now + LIMIT_WINDOW_MS
    };
    usageWindows.set(key, state);
  }

  return { key, state };
}

function usageFor(req) {
  const { state } = getUsageWindow(req);
  return {
    windowId: String(state.resetAt),
    windowHours: LIMIT_WINDOW_HOURS,
    limit: MESSAGE_LIMIT,
    used: state.used,
    remaining: Math.max(0, MESSAGE_LIMIT - state.used),
    resetAt: new Date(state.resetAt).toISOString()
  };
}

app.get('/api/usage', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.json(usageFor(req));
});

app.post('/api/chat', async (req, res) => {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey || apiKey === 'PASTE_YOUR_OPENAI_API_KEY_HERE') {
      console.error('OPENAI_API_KEY is not configured.');
      return res.status(503).json({
        error: 'Chat service is temporarily unavailable.',
        usage: usageFor(req)
      });
    }

    const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const requestedModel = String(req.body?.model || 'gpt-3.5-turbo');
    const model = ALLOWED_MODELS.has(requestedModel) ? requestedModel : 'gpt-3.5-turbo';

    if (!messages.length) {
      return res.status(400).json({ error: 'No messages supplied.', usage: usageFor(req) });
    }
    if (messages.length > 60) {
      return res.status(400).json({ error: 'Conversation is too long for this demo.', usage: usageFor(req) });
    }

    const cleaned = messages.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content || '').slice(0, 8000)
    }));

    const { state } = getUsageWindow(req);
    if (state.used >= MESSAGE_LIMIT) {
      return res.status(429).json({
        error: `${MESSAGE_LIMIT}-message limit reached. Your messages reset every ${LIMIT_WINDOW_HOURS} hours.`,
        usage: usageFor(req)
      });
    }

    // Reserve one slot before contacting the upstream API so rapid repeated
    // requests cannot slip past the quota check.
    state.used += 1;

    const requestBody = {
      model,
      messages: cleaned,
      temperature: 0.8,
      max_tokens: 700
    };

    const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      console.error('OpenAI API error:', data);
      return res.status(upstream.status).json({
        error: data?.error?.message || 'OpenAI API request failed.',
        usage: usageFor(req)
      });
    }

    const message = data?.choices?.[0]?.message?.content;
    if (!message) {
      return res.status(502).json({ error: 'The model returned an empty response.', usage: usageFor(req) });
    }

    res.set('Cache-Control', 'no-store');
    res.json({ message, model, usage: usageFor(req) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error.', usage: usageFor(req) });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`ClassicChat running on port ${PORT}`);
});
