import { unzipSync } from 'fflate';
import { decode, ExtractError } from './common.js';

/** Names of all entries, without unpacking anything. */
export function zipNames(data) {
  const names = [];
  try {
    unzipSync(data, { filter: (file) => (names.push(file.name), false) });
  } catch {
    throw new ExtractError('Die Datei ist beschädigt.');
  }
  return names;
}

/** Unpacks the entries `wanted` accepts. Throws when the archive is unreadable. */
export function readZip(data, wanted) {
  const names = [];
  const files = unzipSync(data, { filter: (file) => (names.push(file.name), wanted(file.name)) });
  return {
    names,
    text: (path) => (files[path] ? decode(files[path]) : ''),
  };
}
