#!/usr/bin/env node
require('dotenv').config();
const mongoose = require('mongoose');
const { importPlaylist } = require('../src/services/importPlaylist');

async function main() {
  const ids = process.argv.slice(2);
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI not set');
  if (!process.env.YOUTUBE_API_KEY) throw new Error('YOUTUBE_API_KEY not set');
  await mongoose.connect(process.env.MONGODB_URI);
  const results = [];
  for (const id of ids) {
    const { course, lectures } = await importPlaylist(id);
    results.push({ courseId: String(course._id), title: course.title, lectures: lectures.length });
  }
  console.log(JSON.stringify({ imported: results.length, results }, null, 2));
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
