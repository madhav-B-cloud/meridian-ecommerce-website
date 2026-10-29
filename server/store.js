'use strict';
/**
 * Tiny JSON-file persistence layer.
 * Each service owns its own "database" file, mirroring the
 * database-per-service pattern of the original Spring Boot platform
 * (auth_db / product_db / inventory_db / order_db).
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const saveTimers = new Map();

function load(name, fallback) {
  const file = path.join(DATA_DIR, `${name}.json`);
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(`[store] failed to read ${name}.json, starting fresh:`, err.message);
  }
  return fallback;
}

/** Debounced write; pass `true` as second arg to flush synchronously. */
function save(name, db, sync = false) {
  const file = path.join(DATA_DIR, `${name}.json`);
  const write = () => {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, file);
    saveTimers.delete(name);
  };
  if (sync) {
    if (saveTimers.has(name)) { clearTimeout(saveTimers.get(name)); saveTimers.delete(name); }
    write();
    return;
  }
  if (saveTimers.has(name)) clearTimeout(saveTimers.get(name));
  saveTimers.set(name, setTimeout(write, 250));
}

function reset(name) {
  const file = path.join(DATA_DIR, `${name}.json`);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

module.exports = { DATA_DIR, load, save, reset };
