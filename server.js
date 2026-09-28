import 'dotenv/config';
import express from 'express';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const app = express();
const PORT = process.env.PORT || 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.set('trust proxy', 1);
app.use(express.json({ limit: '200kb' }));
app.use(express.static(__dirname));

const usageWindows = new Map();
const MESSAGE_LIMIT = Math.max(1, Number(process.env.MESSAGE_LIMIT || 10));
const LIMIT_WINDOW_HOURS = Math.max(1, Number(process.env.LIMIT_WINDOW_HOURS || 3));
const LIMIT_WINDOW_MS = LIMIT_WINDOW_HOURS * 60 * 60 * 1000;
const ALLOWED_MODELS = new Set(['gpt-3.5-turbo']);

// The signed cookie lets a visitor's current quota survive server restarts and
// redeploys instead of resetting whenever the site is updated. The in-memory
// IP map still helps stop rapid multi-tab / same-IP abuse while the server is up.
const USAGE_COOKIE = 'classicchat_usage_v1';
const USAGE_SECRET = process.env.USAGE_SIGNING_SECRET || process.env.OPENAI_API_KEY || 'classicchat-dev-secret';

function stableClientIp(req) {
  const forwarded = req.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function clientFingerprint(req) {
  return crypto.createHash('sha256').update(stableClientIp(req)).digest('hex').slice(0, 24);
}

function parseCookies(req) {
  const raw = req.headers.cookie || '';
  const cookies = {};
  for (const piece of raw.split(';')) {
    const index = piece.indexOf('=');
    if (index === -1) continue;
    const key = piece.slice(0, index).trim();
    const value = piece.slice(index + 1).trim();
    if (key) cookies[key] = value;
  }
  return cookies;
}

function sign(value) {
  return crypto.createHmac('sha256', USAGE_SECRET).update(value).digest('base64url');
}

function readUsageCookie(req) {
  try {
    const token = parseCookies(req)[USAGE_COOKIE];
    if (!token) return null;
    const split = token.lastIndexOf('.');
    if (split <= 0) return null;
    const body = token.slice(0, split);
    const signature = token.slice(split + 1);
    const expected = sign(body);
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload?.client !== clientFingerprint(req)) return null;
    const used = Number(payload?.used);
    const resetAt = Number(payload?.resetAt);
    if (!Number.isFinite(used) || !Number.isFinite(resetAt)) return null;
    if (resetAt <= Date.now()) return null;
    return {
      used: Math.max(0, Math.min(MESSAGE_LIMIT, Math.floor(used))),
      resetAt
    };
  } catch {
    return null;
  }
}

function writeUsageCookie(req, res, state) {
  const payload = {
    client: clientFingerprint(req),
    used: state.used,
    resetAt: state.resetAt
  };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const token = `${body}.${sign(body)}`;
  const maxAgeSeconds = Math.max(60, Math.ceil((state.resetAt - Date.now()) / 1000));
  const secure = req.secure || req.get('x-forwarded-proto') === 'https';
  res.append('Set-Cookie', `${USAGE_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`);
}

function getUsageWindow(req) {
  const key = stableClientIp(req);
  const now = Date.now();
  let state = usageWindows.get(key);

  if (state && (!Number.isFinite(state.resetAt) || now >= state.resetAt)) {
    usageWindows.delete(key);
    state = null;
  }

  const cookieState = readUsageCookie(req);

  if (!state) {
    state = cookieState || { used: 0, resetAt: now + LIMIT_WINDOW_MS };
    usageWindows.set(key, state);
  } else if (cookieState && cookieState.resetAt === state.resetAt) {
    // Keep whichever side has seen more usage. This prevents an older browser
    // response from making the quota go backwards.
    state.used = Math.max(state.used, cookieState.used);
  }

  return { key, state };
}

function usageFor(req, res) {
  const { state } = getUsageWindow(req);
  if (res) writeUsageCookie(req, res, state);
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
  res.json(usageFor(req, res));
});

app.post('/api/chat', async (req, res) => {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey || apiKey === 'PASTE_YOUR_OPENAI_API_KEY_HERE') {
      console.error('OPENAI_API_KEY is not configured.');
      return res.status(503).json({
        error: 'Chat service is temporarily unavailable.',
        usage: usageFor(req, res)
      });
    }

    const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const requestedModel = String(req.body?.model || 'gpt-3.5-turbo');
    const model = ALLOWED_MODELS.has(requestedModel) ? requestedModel : 'gpt-3.5-turbo';

    if (!messages.length) {
      return res.status(400).json({ error: 'No messages supplied.', usage: usageFor(req, res) });
    }
    if (messages.length > 60) {
      return res.status(400).json({ error: 'Conversation is too long for this demo.', usage: usageFor(req, res) });
    }

    const cleaned = messages.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content || '').slice(0, 8000)
    }));

    const { state } = getUsageWindow(req);
    if (state.used >= MESSAGE_LIMIT) {
      const usage = usageFor(req, res);
      return res.status(429).json({
        error: `You have run out of messages. Your ${MESSAGE_LIMIT} messages reset every ${LIMIT_WINDOW_HOURS} hours.`,
        usage
      });
    }

    // Reserve a slot before contacting the upstream API so rapid repeated
    // requests cannot slip past the quota check.
    state.used += 1;
    writeUsageCookie(req, res, state);

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
      // Failed upstream calls should not consume a visitor message.
      state.used = Math.max(0, state.used - 1);
      writeUsageCookie(req, res, state);
      console.error('OpenAI API error:', data);
      return res.status(upstream.status).json({
        error: data?.error?.message || 'OpenAI API request failed.',
        usage: usageFor(req, res)
      });
    }

    const message = data?.choices?.[0]?.message?.content;
    if (!message) {
      state.used = Math.max(0, state.used - 1);
      writeUsageCookie(req, res, state);
      return res.status(502).json({ error: 'The model returned an empty response.', usage: usageFor(req, res) });
    }

    res.set('Cache-Control', 'no-store');
    res.json({ message, model, usage: usageFor(req, res) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error.', usage: usageFor(req, res) });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`ClassicChat running on port ${PORT}`);
});
