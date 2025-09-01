import fs from 'fs';
import { parseString } from 'xml2js';

// Flattener for xml2js objects
function flatten(obj) {
  if (Array.isArray(obj)) {
    return obj.map(flatten);
  } else if (typeof obj === 'object' && obj !== null) {
    const newObj = {};
    for (const [key, value] of Object.entries(obj)) {
      if (key === '$') {
        Object.assign(newObj, value); // merge attributes
      } else if (key === '_') {
        newObj.value = value; // rename text content
      } else {
        newObj[key] = flatten(value);
      }
    }
    // unwrap if object only has "value"
    if (Object.keys(newObj).length === 1 && 'value' in newObj) {
      return newObj.value;
    }
    return newObj;
  }
  return obj;
}

// Transform parsed/flattened EPG into the desired shape
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
        previouslyShown: p['previously-shown'] ? true : false,
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

function convertEPG(xmlFile, jsonFile) {
  fs.readFile(xmlFile, 'utf8', (err, data) => {
    if (err) {
      console.error('❌ Error reading XML file:', err);
      return;
    }

    parseString(data, { explicitArray: false }, (err, result) => {
      if (err) {
        console.error('❌ Error parsing XML:', err);
        return;
      }

      const flat = flatten(result);
      const transformed = transformEPG(flat);

      fs.writeFile(jsonFile, JSON.stringify(transformed, null, 2), (err) => {
        if (err) {
          console.error('❌ Error writing JSON file:', err);
          return;
        }
        console.log(`✅ EPG converted successfully → ${jsonFile}`);
      });
    });
  });
}

function cryptoRandomId() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function toISODate(epgTime) {
  if (!epgTime) return null;
  const match = epgTime.match(
    /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2}) ([\+\-]\d{4})$/
  );
  if (!match) return epgTime;
  const [_, y, mo, d, h, mi, s, offset] = match;
  const dateStr = `${y}-${mo}-${d}T${h}:${mi}:${s}${offset.slice(
    0,
    3
  )}:${offset.slice(3)}`;
  return new Date(dateStr).toISOString();
}

convertEPG('epg.xml', 'epg.json');
