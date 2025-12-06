const express = require('express');
const axios = require('axios');

const router = express.Router();

async function getConfig() {
  const Settings = require('../models/Settings');
  const apiUrl = 'https://generativelanguage.googleapis.com/v1beta/models';
  try {
    const keyDoc = await Settings.findOne({ key: 'gemini.apiKey' });
    const modelDoc = await Settings.findOne({ key: 'gemini.model' });
    const apiKey = (keyDoc && keyDoc.value) ? keyDoc.value : (process.env.GEMINI_API_KEY || '');
    const model = (modelDoc && modelDoc.value) ? modelDoc.value : (process.env.GEMINI_MODEL || 'gemini-2.0-flash');
    return { apiKey, model, apiUrl };
  } catch (_) {
    const apiKey = process.env.GEMINI_API_KEY || '';
    const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
    return { apiKey, model, apiUrl };
  }
}

router.post('/chat', async (req, res) => {
  try {
    const { prompt, courseTitle } = req.body || {};
    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    const { apiKey, model, apiUrl } = await getConfig();
    if (!apiKey) {
      return res.status(200).json({
        text: `⚠️ Gemini API key is not configured.\n\nYour question was:\n${prompt}`,
      });
    }

    const requestBody = {
      contents: [
        {
          parts: [
            {
              text:
                `You are a helpful learning assistant${courseTitle ? ` for the course "${courseTitle}"` : ''}. ` +
                `Explain things clearly and concisely.\n\n` +
                `Student question: ${prompt}`,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 300,
        topP: 0.8,
        topK: 40,
        responseMimeType: 'text/plain',
      },
    };

    const url = `${apiUrl}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const resp = await axios.post(url, requestBody, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000,
    });

    const data = resp.data || {};
    if (data?.promptFeedback?.blockReason) {
      return res.json({
        text: `Your question was blocked by safety filters (${data.promptFeedback.blockReason}).\n\nTry asking it in a simpler / safer way.`,
      });
    }

    let aiResponse = '';
    if (Array.isArray(data?.candidates) && data.candidates.length > 0) {
      const candidate = data.candidates[0];
      if (typeof candidate.text === 'string') {
        aiResponse = candidate.text;
      }
      if (!aiResponse && candidate.content?.parts?.length) {
        aiResponse = candidate.content.parts
          .map((p) => (typeof p.text === 'string' ? p.text : ''))
          .join('\n')
          .trim();
      }
    }

    if (!aiResponse) {
      return res.json({
        text:
          "I couldn't generate a proper answer this time.\n\n" +
          'Try asking a shorter or simpler question, like:\n' +
          "• 'Explain DBMS in simple words'\n" +
          "• 'Example of inheritance in Java'\n",
      });
    }

    return res.json({ text: String(aiResponse).trim() });
  } catch (err) {
    const msg = err?.response?.data?.error?.message || err?.message || 'Unknown error';
    return res.status(200).json({
      text: `Sorry, I couldn't reach the AI right now.\n\n${msg}`,
    });
  }
});

module.exports = router;
