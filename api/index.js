'use strict';

// Vercel serverless entry — an Express app is a valid (req, res) handler,
// so Vercel can invoke it directly. Static files in /public are served by
// Vercel's CDN; only /api/* is rewritten here (see vercel.json).
const app = require('../server/server');

module.exports = app;
