const express = require('express');
const OpenAI = require('openai');

const router = express.Router();

let client;

function getClient() {
  if (!client) {
    client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  return client;
}

function toPlainText(input) {
  if (input == null) {
    return '';
  }

  if (typeof input === 'string') {
    return input.trim();
  }

  if (Array.isArray(input)) {
    return input
      .map(item => toPlainText(item))
      .filter(Boolean)
      .join('\n\n')
      .trim();
  }

  if (typeof input === 'object') {
    if (typeof input.text === 'string') {
      return input.text.trim();
    }

    if (typeof input.content === 'string') {
      return input.content.trim();
    }

    return '';
  }

  return String(input).trim();
}

function normalizeMessages(messages, fallbackText) {
  const normalized = Array.isArray(messages)
    ? messages
        .map(message => {
          if (!message || typeof message !== 'object') {
            return null;
          }

          const role =
            typeof message.role === 'string' && message.role.trim()
              ? message.role.trim()
              : 'user';

          const content = toPlainText(message.content);

          if (!content) {
            return null;
          }

          return { role, content };
        })
        .filter(Boolean)
    : [];

  if (!normalized.length && fallbackText) {
    const fallbackContent = toPlainText(fallbackText);

    if (fallbackContent) {
      normalized.push({ role: 'user', content: fallbackContent });
    }
  }

  return normalized;
}

router.post('/chat', async (req, res) => {
  if (!process.env.OPENAI_API_KEY) {
    console.error('Missing OPENAI_API_KEY environment variable.');
    return res.status(500).json({
      message: 'Server misconfiguration: missing OpenAI API key.',
    });
  }

  const fallbackText =
    req.body?.message ?? req.body?.prompt ?? req.body?.text ?? null;

  const sanitizedMessages = normalizeMessages(req.body?.messages, fallbackText);

  if (!sanitizedMessages.length) {
    return res.status(400).json({
      message:
        'Invalid request body: provide a messages array or a single message string.',
    });
  }

  let timeoutId;
  const fallbackReply =
    'Natural Immunotherapy guidance: stay hydrated, support detox with warm water and fiber-rich foods, use vitamin- and mineral-dense meals, and rest well to boost immunity.';

  try {
    const timeoutMs = Number(
      process.env.OPENAI_TIMEOUT_MS ||
        (process.env.VERCEL ? 8000 : 25000)
    );

    const completionPromise = getClient().chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.7,
      max_tokens: Number(process.env.OPENAI_MAX_TOKENS || 600),
      messages: [
        {
          role: 'system',
          content:
            'You are a Natural Immunotherapy (NIT) expert assistant for Subhankar Sarkar. Natural Immunotherapy is a holistic health system focused on restoring immune balance through nutrition, detoxification, cellular repair, and natural boosters; this topic is always health-related. Always provide clear, practical guidance on how Natural Immunotherapy addresses the user’s concern. You must answer any question related to diseases, immunity, recovery, vitamins, minerals, detoxification, enzymes, boosters, chronic conditions (such as cancer, thalassemia, CKD), nutrition, or health improvement. Only refuse questions that are clearly outside health, wellness, or the human body (e.g., politics, technology, sports). When refusing, reply: "Please ask me only health-related questions about your body, immunity, or recovery." Never refuse to discuss Natural Immunotherapy itself and always explain its natural protocols, nutrients, or detox strategies that apply to the situation. Maintain an encouraging, educational tone grounded in Natural Immunotherapy principles.',
        },
        ...sanitizedMessages,
      ],
    });

    // Prevent unhandled rejection when we short-circuit on timeout.
    completionPromise.catch(error =>
      console.warn('OpenAI completion finished after timeout', error?.message)
    );

    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error('OpenAI request exceeded timeout budget')),
        timeoutMs
      );
    });

    const completion = await Promise.race([completionPromise, timeoutPromise]);

    const reply =
      completion?.choices?.[0]?.message?.content?.trim() ||
      'Please ask me only health-related questions about your body, immunity, or recovery.';

    return res.status(200).json({ reply });
  } catch (error) {
    const detail =
      error?.response?.data?.error?.message ||
      error?.message ||
      'Unknown error';

    const timedOut =
      error?.name === 'AbortError' ||
      /timeout budget|timed out|abort/i.test(detail || '');

    console.error('OpenAI chat route failed:', detail);

    if (timedOut) {
      return res.status(200).json({
        reply:
          'I needed extra time to craft a full response, but here is a quick NIT tip: focus on detox (warm water + fiber), balanced vitamins/minerals, and deep rest so your immunity can recover.',
        detail,
      });
    }

    return res.status(500).json({
      message: 'Unable to process the chat request at this time.',
      detail,
      fallback: fallbackReply,
    });
  } finally {
    if (typeof timeoutId !== 'undefined') {
      clearTimeout(timeoutId);
    }
  }
});

router.get('/chat/test', (_req, res) => {
  res.status(200).json({
    message: 'Chat service is reachable',
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;