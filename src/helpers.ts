import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(__dirname, 'data');

/**
 * Reads a JSON file from src/data/ and returns its parsed contents.
 * Returns an empty array if the file doesn't exist.
 */
export function readData<T>(fileName: string): T[] {
  const filePath = path.join(DATA_DIR, fileName);
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as T[];
}

/**
 * Serialises `data` and writes it to src/data/<fileName> synchronously,
 * ensuring changes are immediately persisted on the server.
 */
export function saveData<T>(fileName: string, data: T[]): void {
  const filePath = path.join(DATA_DIR, fileName);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}
