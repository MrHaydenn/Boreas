import {execFile} from 'node:child_process';
import {setPriority} from 'node:os';

export function analysisProcess(children, binary, args, {light, timeout = 3600000} = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(binary, args, {encoding: 'buffer', windowsHide: true, timeout, maxBuffer: 4 * 1024 * 1024}, (error, stdout) => {
      children.delete(child);
      if (error) reject(error);
      else resolve(stdout);
    });
    children.add(child);
    if (light && child.pid) {
      try { setPriority(child.pid, 19); } catch {}
    }
  });
}

const step = 4096 / 11025 / 3;
function distance(a, b) {
  let value = a ^ b;
  value -= (value >>> 1) & 0x55555555;
  value = (value & 0x33333333) + ((value >>> 2) & 0x33333333);
  return (((value + (value >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

export function compareIntros(first, second) {
  const positions = new Map();
  for (let index = 0; index < second.length; index++) {
    const word = second[index];
    for (const key of [word >>> 16, 65536 + (word & 65535)]) {
      const list = positions.get(key) || [];
      if (list.length < 64) list.push(index);
      positions.set(key, list);
    }
  }
  const offsets = new Map();
  for (let index = 0; index < first.length; index += 5) {
    const word = first[index];
    for (const key of [word >>> 16, 65536 + (word & 65535)]) {
      for (const candidate of positions.get(key) || []) {
        const shift = candidate - index;
        offsets.set(shift, (offsets.get(shift) || 0) + 1);
      }
    }
  }
  let best;
  for (const [shift] of [...offsets].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    let start = -1, last = -1, hits = 0, distinct = new Set();
    for (let index = Math.max(0, -shift); index < Math.min(first.length, second.length - shift); index++) {
      if (distance(first[index], second[index + shift]) <= 7) {
        if (start < 0) start = index;
        last = index;
        hits++;
        distinct.add(first[index]);
      } else if (index - last > 4) {
        start = -1;
        hits = 0;
        distinct = new Set();
      }
      const length = last - start + 1;
      if (start >= 0 && length * step >= 20 && hits / length >= .75 && distinct.size >= 24 && (!best || length > best.length)) {
        best = {length, start: start * step, end: (last + 1) * step, otherStart: (start + shift) * step, otherEnd: (last + shift + 1) * step};
      }
    }
  }
  return best;
}
