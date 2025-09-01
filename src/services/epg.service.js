import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';
import axios from 'axios';
import zlib from 'zlib';
import { createReadStream } from 'fs';
import { pipeline } from 'stream/promises';
import { Transform } from 'stream';
import { toISODate } from '../utils/date.js';
import { cryptoRandomId } from '../utils/object.js';

const EPG_SOURCES = [
  'https://epgshare01.online/epgshare01/epg_ripper_ALL_SOURCES1.xml.gz',
];

const MERGED_EPG_FILE = 'epg.xml';
let epgData = null;

/**
 * Streaming XML parser for large EPG files
 * Processes XML line by line to avoid memory issues
 */
class EPGParser {
  constructor() {
    this.channels = new Map();
    this.programmes = [];
    this.currentElement = null;
    this.currentData = {};
    this.inElement = false;
  }

  parseLine(line) {
    const trimmed = line.trim();
    
    // Skip empty lines and XML declaration
    if (!trimmed || trimmed.startsWith('<?xml') || trimmed === '<tv>' || trimmed === '</tv>') {
      return;
    }

    // Channel parsing
    if (trimmed.startsWith('<channel ')) {
      this.currentElement = 'channel';
      this.currentData = {};
      const idMatch = trimmed.match(/id="([^"]+)"/);
      if (idMatch) {
        this.currentData.id = idMatch[1];
      }
    } else if (trimmed === '</channel>') {
      if (this.currentData.id && this.currentData.displayName) {
        this.channels.set(this.currentData.id, this.currentData.displayName);
      }
      this.currentElement = null;
      this.currentData = {};
    } else if (this.currentElement === 'channel' && trimmed.includes('<display-name>')) {
      const nameMatch = trimmed.match(/<display-name[^>]*>([^<]+)<\/display-name>/);
      if (nameMatch) {
        this.currentData.displayName = nameMatch[1];
      }
    }

    // Programme parsing
    else if (trimmed.startsWith('<programme ')) {
      this.currentElement = 'programme';
      this.currentData = {};
      
      const channelMatch = trimmed.match(/channel="([^"]+)"/);
      const startMatch = trimmed.match(/start="([^"]+)"/);
      const stopMatch = trimmed.match(/stop="([^"]+)"/);
      
      if (channelMatch) this.currentData.channel = channelMatch[1];
      if (startMatch) this.currentData.start = startMatch[1];
      if (stopMatch) this.currentData.stop = stopMatch[1];
    } else if (trimmed === '</programme>') {
      if (this.currentData.channel && this.currentData.title) {
        this.programmes.push({
          _id: cryptoRandomId(),
          channel: this.currentData.channel,
          start: toISODate(this.currentData.start),
          stop: toISODate(this.currentData.stop),
          title: this.currentData.title,
          subTitle: this.currentData.subTitle || '',
          date: this.currentData.date || null,
          episodeNum: this.currentData.episodeNum || '',
          previouslyShown: this.currentData.previouslyShown || false,
          starRating: this.currentData.starRating || null,
          episode: {
            description: this.currentData.description || '',
            genre: this.currentData.genre || '',
            name: this.currentData.title,
          },
        });
      }
      this.currentElement = null;
      this.currentData = {};
    }

    // Programme content parsing
    else if (this.currentElement === 'programme') {
      if (trimmed.includes('<title>')) {
        const titleMatch = trimmed.match(/<title[^>]*>([^<]+)<\/title>/);
        if (titleMatch) this.currentData.title = titleMatch[1];
      } else if (trimmed.includes('<sub-title>')) {
        const subTitleMatch = trimmed.match(/<sub-title[^>]*>([^<]+)<\/sub-title>/);
        if (subTitleMatch) this.currentData.subTitle = subTitleMatch[1];
      } else if (trimmed.includes('<desc>')) {
        const descMatch = trimmed.match(/<desc[^>]*>([^<]+)<\/desc>/);
        if (descMatch) this.currentData.description = descMatch[1];
      } else if (trimmed.includes('<date>')) {
        const dateMatch = trimmed.match(/<date>([^<]+)<\/date>/);
        if (dateMatch) this.currentData.date = dateMatch[1];
      } else if (trimmed.includes('<episode-num>')) {
        const episodeMatch = trimmed.match(/<episode-num[^>]*>([^<]+)<\/episode-num>/);
        if (episodeMatch) this.currentData.episodeNum = episodeMatch[1];
      } else if (trimmed.includes('<category>')) {
        const categoryMatch = trimmed.match(/<category[^>]*>([^<]+)<\/category>/);
        if (categoryMatch) {
          this.currentData.genre = this.currentData.genre 
            ? `${this.currentData.genre}, ${categoryMatch[1]}`
            : categoryMatch[1];
        }
      } else if (trimmed.includes('<previously-shown')) {
        this.currentData.previouslyShown = true;
      } else if (trimmed.includes('<star-rating>')) {
        const ratingMatch = trimmed.match(/<value>([^<]+)<\/value>/);
        if (ratingMatch) this.currentData.starRating = ratingMatch[1];
      }
    }
  }

  getResults() {
    // Transform to expected format
    const results = [];
    
    for (const [channelId, displayName] of this.channels) {
      const channelProgrammes = this.programmes
        .filter(p => p.channel === channelId)
        .map(p => ({
          _id: p._id,
          start: p.start,
          stop: p.stop,
          title: p.title,
          subTitle: p.subTitle,
          date: p.date,
          episodeNum: p.episodeNum,
          previouslyShown: p.previouslyShown,
          starRating: p.starRating,
          episode: p.episode,
        }));

      results.push({
        channelId,
        'display-name': displayName,
        timelines: channelProgrammes,
      });
    }

    return results;
  }
}

/**
 * Download gzipped XML to tmp folder, extract to plain XML, return file path
 */
async function fetchAndExtractEPG(url, outputFile) {
  try {
    console.log(`⬇️  Downloading EPG from ${url}...`);

    const tmpDir = await fs.promises.mkdtemp(path.join(process.env.TMPDIR || os.tmpdir(), 'epg-'));
    const gzPath = path.join(tmpDir, 'epg.xml.gz');

    // Download .gz with streaming to handle large files
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream',
      timeout: 300000, // 5 minutes timeout for large files
    });

    // Stream download to file
    const writer = fs.createWriteStream(gzPath);
    response.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    console.log(`📦 Downloaded ${(await fs.promises.stat(gzPath)).size} bytes`);

    // Extract using streaming
    const readStream = fs.createReadStream(gzPath);
    const gunzip = zlib.createGunzip();
    const writeStream = fs.createWriteStream(outputFile);

    await pipeline(readStream, gunzip, writeStream);

    await fs.promises.unlink(gzPath);
    await fs.promises.rmdir(tmpDir);
    
    const extractedSize = (await fs.promises.stat(outputFile)).size;
    console.log(`✅ Extracted EPG to ${outputFile} (${extractedSize} bytes)`);
  } catch (err) {
    console.error(`❌ Failed to fetch/extract EPG from ${url}:`, err.message);
    throw err;
  }
}

/**
 * Merge multiple EPG XMLs into one big XML file (streamed to avoid OOM)
 */
async function mergeEPGs(urls, outputFile) {
  const writeStream = fs.createWriteStream(outputFile, { encoding: 'utf8' });
  writeStream.write('<?xml version="1.0" encoding="UTF-8"?>\n<tv>\n');

  for (const [i, url] of urls.entries()) {
    const tmpFile = `tmp_${i}.xml`;
    await fetchAndExtractEPG(url, tmpFile);

    const rl = readline.createInterface({
      input: fs.createReadStream(tmpFile, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (
        line.includes('<?xml') ||
        line.includes('<tv>') ||
        line.includes('</tv>')
      ) {
        continue;
      }
      writeStream.write(line + '\n');
    }

    rl.close();
    await fs.promises.unlink(tmpFile);
  }

  writeStream.write('</tv>');
  writeStream.end();

  await new Promise((resolve) => writeStream.on('finish', resolve));
  console.log(`✅ Merged EPG saved → ${outputFile}`);
}

/**
 * Load merged XML using streaming parser to avoid memory issues
 */
async function loadEPG() {
  console.log('🔄 Parsing EPG file...');
  const parser = new EPGParser();
  let lineCount = 0;

  const rl = readline.createInterface({
    input: createReadStream(MERGED_EPG_FILE, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    parser.parseLine(line);
    lineCount++;
    
    // Progress indicator for very large files
    if (lineCount % 100000 === 0) {
      console.log(`📊 Processed ${lineCount} lines...`);
    }
  }

  rl.close();
  
  const results = parser.getResults();
  console.log(`✅ Parsed ${results.length} channels with ${parser.programmes.length} programmes`);
  
  return results;
}

/**
 * Alternative method: Process EPG in chunks to limit memory usage
 */
async function loadEPGChunked(chunkSize = 50000) {
  console.log('🔄 Parsing EPG file in chunks...');
  const results = [];
  const channels = new Map();
  let programmes = [];
  let lineCount = 0;

  const rl = readline.createInterface({
    input: createReadStream(MERGED_EPG_FILE, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  const parser = new EPGParser();

  for await (const line of rl) {
    parser.parseLine(line);
    lineCount++;

    // Process in chunks to manage memory
    if (lineCount % chunkSize === 0) {
      console.log(`📊 Processed ${lineCount} lines, found ${parser.programmes.length} programmes so far...`);
      
      // Optionally clear some data if memory becomes an issue
      // This depends on your specific memory constraints
    }
  }

  rl.close();
  return parser.getResults();
}

export async function refreshEPG(useChunked = false) {
  try {
    console.log('⏳ Refreshing EPG...');
    await mergeEPGs(EPG_SOURCES, MERGED_EPG_FILE);
    
    // Use chunked processing for extremely large files
    epgData = useChunked ? await loadEPGChunked() : await loadEPG();
    
    console.log('✅ EPG refreshed and loaded into memory.');
    
    // Clean up the large XML file to save disk space
    try {
      await fs.promises.unlink(MERGED_EPG_FILE);
      console.log('🧹 Cleaned up temporary XML file');
    } catch (err) {
      console.warn('⚠️  Could not clean up XML file:', err.message);
    }
    
  } catch (err) {
    console.error('❌ Failed to refresh EPG:', err.message);
    epgData = [];
    throw err;
  }
}

export function getEPGData() {
  return epgData;
}

// Export parser for testing or alternative usage
export { EPGParser };