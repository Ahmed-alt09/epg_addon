import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import axios from 'axios';
import zlib from 'zlib';
import { parseString } from 'xml2js';
import { flatten } from '../utils/object.js';
import { toISODate } from '../utils/date.js';
import { cryptoRandomId } from '../utils/object.js';

const EPG_SOURCES = [
  'https://epgshare01.online/epgshare01/epg_ripper_ALL_SOURCES1.xml.gz',
];

const MERGED_EPG_FILE = 'epg.xml';
let epgData = null;


function transformEPG(flatEPG) {
  const channels = Array.isArray(flatEPG.tv.channel)
    ? flatEPG.tv.channel
    : [flatEPG.tv.channel];

  const programmes = Array.isArray(flatEPG.tv.programme)
    ? flatEPG.tv.programme
    : [flatEPG.tv.programme];

  return channels.map((channel) => {
    const channelId = channel.id;
    const displayName = channel['display-name'];

    const channelProgrammes = programmes
      .filter((p) => p.channel === channelId)
      .map((p) => ({
        _id: cryptoRandomId(),
        start: toISODate(p.start),
        stop: toISODate(p.stop),
        title: typeof p.title === 'object' ? p.title.value : p.title,
        subTitle:
          p['sub-title'] && typeof p['sub-title'] === 'object'
            ? p['sub-title'].value
            : p['sub-title'] || '',
        date: p.date || null,
        episodeNum:
          p['episode-num'] && typeof p['episode-num'] === 'object'
            ? p['episode-num'].value
            : p['episode-num'] || '',
        previouslyShown: !!p['previously-shown'],
        starRating:
          p['star-rating'] && typeof p['star-rating'].value === 'string'
            ? p['star-rating'].value
            : null,
        episode: {
          description:
            typeof p.desc === 'object' ? p.desc.value : p.desc || '',
          genre: Array.isArray(p.category)
            ? p.category
                .map((c) => (typeof c === 'object' ? c.value : c))
                .join(', ')
            : p.category || '',
          name: typeof p.title === 'object' ? p.title.value : p.title,
        },
      }));

    return {
      channelId,
      'display-name': displayName,
      timelines: channelProgrammes,
    };
  });
}

async function fetchAndExtractEPG(url) {
  try {
    console.log(`⬇️  Downloading EPG from ${url}...`);

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'epg-'));
    const gzPath = path.join(tmpDir, 'epg.xml.gz');
    const xmlPath = path.join(tmpDir, 'epg.xml');

    const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 60000 });
    await fs.writeFile(gzPath, response.data);

    const buffer = await fs.readFile(gzPath);
    const extracted = zlib.gunzipSync(buffer);
    await fs.writeFile(xmlPath, extracted);

    await fs.unlink(gzPath);

    console.log(`✅ Extracted XML → ${xmlPath}`);
    return xmlPath;
  } catch (err) {
    console.error(`❌ Failed to fetch/extract EPG from ${url}:`, err.message);
    throw err;
  }
}


async function mergeEPGs(urls, outputFile) {
  let mergedXml = '<?xml version="1.0" encoding="UTF-8"?>\n<tv>\n';

  for (const url of urls) {
    const xmlPath = await fetchAndExtractEPG(url);
    let content = await fs.readFile(xmlPath, 'utf8');
    content = content.replace(/<\?xml[^>]*\?>/, '').replace(/<\/?tv>/g, '');
    mergedXml += content.trim() + '\n';
    await fs.unlink(xmlPath);
  }

  mergedXml += '</tv>';
  await fs.writeFile(outputFile, mergedXml, 'utf8');
  console.log(`✅ Merged EPG saved → ${outputFile}`);
}


async function loadEPG() {
  const data = await fs.readFile(MERGED_EPG_FILE, 'utf8');
  return new Promise((resolve, reject) => {
    parseString(data, { explicitArray: false }, (err, result) => {
      if (err) return reject(err);
      const flat = flatten(result);
      resolve(transformEPG(flat));
    });
  });
}

export async function refreshEPG() {
  try {
    console.log('⏳ Refreshing EPG...');
    await mergeEPGs(EPG_SOURCES, MERGED_EPG_FILE);
    epgData = await loadEPG();
    console.log('✅ EPG refreshed and loaded into memory.');
  } catch (err) {
    console.error('❌ Failed to refresh EPG:', err.message);
    epgData = [];
    throw err;
  }
}

export function getEPGData() {
  return epgData;
}
