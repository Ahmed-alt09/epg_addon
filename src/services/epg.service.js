import fs from 'fs';
import zlib from 'zlib';
import axios from 'axios';
import { parseString } from 'xml2js';
import { flatten } from '../utils/object.js';
import { toISODate } from '../utils/date.js';
import { cryptoRandomId } from '../utils/object.js';

const EPG_SOURCES = [
  'https://epgshare01.online/epgshare01/epg_ripper_US1.xml.gz',
  'https://epgshare01.online/epgshare01/epg_ripper_UY1.xml.gz',
  'https://epgshare01.online/epgshare01/epg_ripper_NG1.xml.gz'
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
      .map((p) => {
        // handle episode-num
        let episodeNum = '';
        let episodeNumSystem = '';
        if (p['episode-num']) {
          if (typeof p['episode-num'] === 'object') {
            episodeNum = p['episode-num']._ || p['episode-num'].value || '';
            episodeNumSystem = p['episode-num'].$?.system || '';
          } else {
            episodeNum = p['episode-num'];
          }
        }

        // handle rating
        let rating = '';
        let ratingSystem = '';
        if (p.rating) {
          if (Array.isArray(p.rating)) {
            // take the first rating if multiple
            const r = p.rating[0];
            rating = r.value || r._ || '';
            ratingSystem = r.$?.system || '';
          } else {
            rating = p.rating.value || p.rating._ || '';
            ratingSystem = p.rating.$?.system || '';
          }
        }

        return {
          _id: cryptoRandomId(),
          start: toISODate(p.start),
          stop: toISODate(p.stop),
          title: typeof p.title === 'object' ? p.title.value : p.title,
          subTitle:
            p['sub-title'] && typeof p['sub-title'] === 'object'
              ? p['sub-title'].value
              : p['sub-title'] || '',
          date: p.date || null,
          episodeNum,
          episodeNumSystem,
          previouslyShown: !!p['previously-shown'],
          starRating:
            p['star-rating'] && typeof p['star-rating'].value === 'string'
              ? p['star-rating'].value
              : null,
          rating,
          ratingSystem,
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
        };
      });

    return {
      channelId,
      'display-name': displayName,
      timelines: channelProgrammes,
    };
  });
}


async function fetchAndExtractEPG(url, outputFile) {
  try {
    console.log(`Downloading EPG from ${url}...`);

    const response = await axios({
      method: 'get',
      url,
      responseType: 'stream',
      timeout: 60000,
    });

    console.log(`📦 Extracting EPG to ${outputFile}...`);

    return new Promise((resolve, reject) => {
      const gunzip = zlib.createGunzip();
      const writeStream = fs.createWriteStream(outputFile);

      response.data
        .pipe(gunzip)
        .pipe(writeStream)
        .on('finish', () => {
          console.log(`✅ Extracted EPG to ${outputFile}`);
          resolve();
        })
        .on('error', (err) => {
          console.error(`❌ Error extracting ${url}:`, err.message);
          reject(err);
        });
    });
  } catch (err) {
    console.error(`❌ Failed to fetch/extract EPG from ${url}:`, err.message);
    throw err;
  }
}

async function mergeEPGs(urls, outputFile) {
  let mergedXml = '<?xml version="1.0" encoding="UTF-8"?>\n<tv>\n';

  for (const [i, url] of urls.entries()) {
    const tmpFile = `tmp_${i}.xml`;
    await fetchAndExtractEPG(url, tmpFile);

    let content = fs.readFileSync(tmpFile, 'utf8');

    content = content
      .replace(/<\?xml[^>]*\?>/g, '')  
      .replace(/<!DOCTYPE[^>]*>/g, '') 
      .replace(/<\/?tv[^>]*>/g, '')    
      .trim();

    if (!content || content.length < 100) {
      console.warn(`⚠️ Skipping ${url}, file too small or broken`);
      continue;
    }

  
    const lines = content.split('\n');
    if (lines.length > 0) {
      const lastLine = lines[lines.length - 1];
      if (!lastLine.trim().endsWith('>')) {
        console.warn(`⚠️ Trimming broken line from ${url}`);
        lines.pop();
      }
    }

    mergedXml += lines.join('\n') + '\n';
    fs.unlinkSync(tmpFile);
  }

  mergedXml += '</tv>';
  fs.writeFileSync(outputFile, mergedXml, 'utf8');
  console.log(`✅ Merged EPG saved → ${outputFile}`);
}


async function loadEPG() {
  const data = fs.readFileSync(MERGED_EPG_FILE, 'utf8');
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
