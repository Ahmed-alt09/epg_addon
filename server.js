import express from 'express';
import cron from 'node-cron';
import { refreshEPG } from './src/services/epg.service.js';
import guideRoutes from './src/routes/guide.routes.js';

const app = express();
const PORT = 7860;

app.use('/v2/guide', guideRoutes);


cron.schedule('32 5 * * *', () => {
  refreshEPG();
});

await refreshEPG();

app.get('/', (req, res) => {
  res.send('EPG Addon is running!');
});

app.listen(PORT, () => {
  console.log(`✅ EPG server running → http://localhost:${PORT}`);
});
