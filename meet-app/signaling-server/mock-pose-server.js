const express = require('express');
const cors = require('cors');

const app = express();
const port = Number(process.env.POSE_MOCK_PORT || 8787);

app.use(cors());
app.use(express.json());

function buildMockPose(text) {
  const chars = String(text || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .split('');

  const ids = chars.map((char, index) => ((char.charCodeAt(0) || 65) + index) % 120);
  const poseIds = ids.length ? ids : [12, 34, 56];
  const timings = poseIds.map((_, index) => index * 120);

  return { poseIds, timings };
}

app.post('/pose', (req, res) => {
  const text = req.body?.text || '';
  res.json(buildMockPose(text));
});

app.get('/health', (_, res) => {
  res.json({ ok: true });
});

app.listen(port, () => {
  console.log(`Mock pose server running on http://localhost:${port}`);
});
