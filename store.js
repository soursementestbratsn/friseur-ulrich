'use strict';

/**
 * Простое JSON-хранилище без зависимостей.
 * Каждая коллекция — файл в папке data/ (путь задаётся через DATA_DIR).
 * Запись атомарная: пишем во временный файл и переименовываем.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'data');

const locks = new Map();

function fileFor(name) {
  return path.join(DATA_DIR, name + '.json');
}

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readAll(name) {
  ensureDir();
  const file = fileFor(name);
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    // Битый файл не должен ронять сервер — отдаём пустую коллекцию.
    console.error('[store] не удалось прочитать ' + name + '.json:', err.message);
    return [];
  }
}

function writeAll(name, rows) {
  ensureDir();
  const file = fileFor(name);
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(rows, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

/** Добавляет запись и возвращает её. */
function insert(name, row) {
  const list = readAll(name);
  const item = Object.assign(
    {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString()
    },
    row
  );
  list.push(item);
  writeAll(name, list);
  return item;
}

/** Обновляет запись по id. Возвращает обновлённую или null. */
function update(name, id, patch) {
  const list = readAll(name);
  const idx = list.findIndex((item) => item.id === id);
  if (idx === -1) return null;
  list[idx] = Object.assign({}, list[idx], patch, { updatedAt: new Date().toISOString() });
  writeAll(name, list);
  return list[idx];
}

/** Удаляет запись по id. Возвращает true/false. */
function remove(name, id) {
  const list = readAll(name);
  const next = list.filter((item) => item.id !== id);
  if (next.length === list.length) return false;
  writeAll(name, next);
  return true;
}

function get(name, id) {
  return readAll(name).find((item) => item.id === id) || null;
}

/** Последовательная очередь, чтобы параллельные записи не теряли данные. */
function withLock(name, fn) {
  const prev = locks.get(name) || Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(
    name,
    next.catch(() => {}).then(() => {
      if (locks.get(name) === next) locks.delete(name);
    })
  );
  return next;
}

module.exports = {
  DATA_DIR,
  ensureDir,
  readAll,
  writeAll,
  insert,
  update,
  remove,
  get,
  withLock
};
