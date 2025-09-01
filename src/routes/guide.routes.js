import express from 'express';
import { getEPGData } from '../services/epg.service.js';

const router = express.Router();

router.get('/timelines', async (req, res) => {
  try {
    const { start, channelIds, duration } = req.query;

    if (!start || !channelIds || !duration) {
      return res.status(400).json({
        error: 'Missing required query params: start, channelIds, duration',
      });
    }

    const epgData = getEPGData();
    if (!epgData) {
      return res.status(503).json({ error: 'EPG data not loaded yet' });
    }

    const startTime = new Date(start);
    const durationMinutes = parseInt(duration, 10);
    const endTime = new Date(startTime.getTime() + durationMinutes * 60000);

    const ids = channelIds.split(',');

    const response = epgData
      .filter((c) => ids.includes(c.channelId))
      .map((c) => ({
        channelId: c.channelId,
        'display-name': c['display-name'],
        timelines: c.timelines.filter((t) => {
          const progStart = new Date(t.start);
          const progStop = new Date(t.stop);
          return progStart < endTime && progStop > startTime;
        }),
      }));

    res.json(response);
  } catch (err) {
    console.error('❌ Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;