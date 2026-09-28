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

// Starter abuse protection. For a public production site, replace this in-memory
// store with Redis / a database so limits survive restarts and multiple servers.
const dailyUsage = new Map();
const DAILY_MESSAGE_LIMIT = Number(process.env.DAILY_MESSAGE_LIMIT || 30);

function usageKey(req) {
  const day = new Date().toISOString().slice(0, 10);
  return `${day}:${req.ip}`;
}

app.post('/api/chat', async (req, res) => {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey || apiKey === 'PASTE_YOUR_OPENAI_API_KEY_HERE') {
      console.error('OPENAI_API_KEY is not configured.');
      return res.status(503).json({ error: 'Chat service is temporarily unavailable.' });
    }

    const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
    if (!messages.length) return res.status(400).json({ error: 'No messages supplied.' });
    if (messages.length > 60) return res.status(400).json({ error: 'Conversation is too long for this demo.' });

    const cleaned = messages.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content || '').slice(0, 8000)
    }));

    const key = usageKey(req);
    const used = dailyUsage.get(key) || 0;
    if (used >= DAILY_MESSAGE_LIMIT) {
      return res.status(429).json({ error: `Daily free limit reached (${DAILY_MESSAGE_LIMIT} messages).` });
    }

    // Count before the upstream request so repeated failing abuse cannot bypass the limiter.
    dailyUsage.set(key, used + 1);

    const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: cleaned,
        temperature: 0.8,
        max_tokens: 700
      })
    });

    const data = await upstream.json();
    if (!upstream.ok) {
      console.error('OpenAI API error:', data);
      return res.status(upstream.status).json({ error: data?.error?.message || 'OpenAI API request failed.' });
    }

    const message = data?.choices?.[0]?.message?.content;
    if (!message) return res.status(502).json({ error: 'The model returned an empty response.' });
    res.json({ message });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error.' });
  }
});

app.listen(PORT, () => {
  console.log(`ClassicChat running on http://localhost:${PORT}`);
});
