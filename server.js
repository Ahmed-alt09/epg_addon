import express from 'express';
import cron from 'node-cron';
import { checkAndRefreshEPG } from './src/services/epg.service.js';
import guideRoutes from './src/routes/guide.routes.js';

const app = express();
//7860
const PORT = 7860;

app.use('/v2/guide', guideRoutes);

cron.schedule('0 * * * *', async () => {
  console.log('⏳ Hourly EPG check running...');
  await checkAndRefreshEPG();
});

await checkAndRefreshEPG();

app.get('/', (req, res) => {
  res.send('EPG Addon is running!');
});

app.listen(PORT, () => {
  console.log(`EPG server running → http://localhost:${PORT}`);
});
