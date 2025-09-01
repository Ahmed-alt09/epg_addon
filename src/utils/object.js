export function flatten(obj) {
  if (Array.isArray(obj)) {
    return obj.map(flatten);
  } else if (typeof obj === 'object' && obj !== null) {
    const newObj = {};
    for (const [key, value] of Object.entries(obj)) {
      if (key === '$') {
        Object.assign(newObj, value);
      } else if (key === '_') {
        newObj.value = value;
      } else {
        newObj[key] = flatten(value);
      }
    }
    if (Object.keys(newObj).length === 1 && 'value' in newObj) {
      return newObj.value;
    }
    return newObj;
  }
  return obj;
}

export function cryptoRandomId() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}