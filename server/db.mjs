import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
export const dataDir = path.resolve(process.env.DATA_DIR || "data");
mkdirSync(dataDir, { recursive: true });
export const db = new DatabaseSync(path.join(dataDir, "music.sqlite"));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS tracks(id TEXT PRIMARY KEY, document TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS playlists(id TEXT PRIMARY KEY, document TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS events(track_id TEXT NOT NULL, play_id TEXT NOT NULL, kind TEXT NOT NULL, created INTEGER NOT NULL, UNIQUE(track_id,play_id,kind));
PRAGMA user_version=1;`);
export const allTracks = () =>
  db
    .prepare("SELECT document FROM tracks")
    .all()
    .map((r) => JSON.parse(r.document))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
export const getTrack = (id) => {
  const r = db.prepare("SELECT document FROM tracks WHERE id=?").get(id);
  return r ? JSON.parse(r.document) : null;
};
export const saveTrack = (track) =>
  db
    .prepare(
      "INSERT INTO tracks(id,document) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document",
    )
    .run(track.id, JSON.stringify(track));
export const allPlaylists = () =>
  db
    .prepare("SELECT document FROM playlists")
    .all()
    .map((r) => JSON.parse(r.document));
export const savePlaylist = (list) =>
  db
    .prepare(
      "INSERT INTO playlists(id,document) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document",
    )
    .run(list.id, JSON.stringify(list));
export const setting = (key) =>
  db.prepare("SELECT value FROM settings WHERE key=?").get(key)?.value;
export const setSetting = (key, value) =>
  db
    .prepare(
      "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    )
    .run(key, value);
export function publicTrack(t) {
  const { originalName, processingError, rightsEvidence, importId, ...rest } =
    t;
  return rest;
}
