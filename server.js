const express = require('express');
const path = require('path');
const mockAdapter = require('./src/adapter');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// Simple API: GET /api/collections?postcode=DE61JP
app.get('/api/collections', async (req, res) => {
  const postcode = (req.query.postcode || '').replace(/\s+/g, '').toUpperCase();
  try {
    const data = await mockAdapter.getCollectionsForPostcode(postcode);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'adapter_error', message: String(err) });
  }
});

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
