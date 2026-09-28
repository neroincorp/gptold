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

// Starter abuse protection. For a larger public deployment, replace this
// in-memory store with Redis / a database so quotas survive every redeploy
// and can be shared across multiple server instances.
const dailyUsage = new Map();
const DAILY_MESSAGE_LIMIT = Math.max(1, Number(process.env.DAILY_MESSAGE_LIMIT || 30));
const ALLOWED_MODELS = new Set(['gpt-3.5-turbo', 'gpt-5-nano']);

function utcDayString(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function stableClientIp(req) {
  const forwarded = req.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function usageKey(req) {
  return `${utcDayString()}:${stableClientIp(req)}`;
}

function nextResetAt() {
  const now = new Date();
  return new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0, 0, 0, 0
  )).toISOString();
}

function usageFor(req) {
  const used = dailyUsage.get(usageKey(req)) || 0;
  return {
    day: utcDayString(),
    limit: DAILY_MESSAGE_LIMIT,
    used,
    remaining: Math.max(0, DAILY_MESSAGE_LIMIT - used),
    resetAt: nextResetAt()
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

    const key = usageKey(req);
    const used = dailyUsage.get(key) || 0;
    if (used >= DAILY_MESSAGE_LIMIT) {
      return res.status(429).json({
        error: `Daily free limit reached (${DAILY_MESSAGE_LIMIT} messages).`,
        usage: usageFor(req)
      });
    }

    // Reserve one message before contacting the upstream API. That prevents
    // rapid repeated requests from slipping past the quota check.
    dailyUsage.set(key, used + 1);

    const requestBody = {
      model,
      messages: cleaned
    };

    if (model === 'gpt-5-nano') {
      // GPT-5 nano is a reasoning model. Minimal effort keeps this chat mode
      // quick and inexpensive; max_completion_tokens includes reasoning tokens.
      requestBody.reasoning_effort = 'minimal';
      requestBody.max_completion_tokens = 1200;
    } else {
      requestBody.temperature = 0.8;
      requestBody.max_tokens = 700;
    }

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
