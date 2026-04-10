// ================================================================================
// This file was generated and/or modified with the assistance of AI (GitHub Copilot)
// ================================================================================
// This script extracts strava-archiv.zip, processes all activities, and generates
// a KML file grouped by activity type.
import AdmZip from 'adm-zip';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { parseStringPromise } from 'xml2js';
import { parse } from 'csv-parse/sync';

// --- Types -------------------------------------------------------------------

type Point = { lat: number; lon: number; time?: string };

// --- File system helpers -----------------------------------------------------

function removeDirRecursive(dirPath: string): void {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
}

function extractZip(zipPath: string, destDir: string): void {
  const zip = new AdmZip(zipPath);
  zip.extractAllTo(destDir, true);
}

function extractGzFilesRecursively(dir: string): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      extractGzFilesRecursively(fullPath);
    } else if (entry.isFile() && entry.name.endsWith('.gz')) {
      const destFile = fullPath.replace(/\.gz$/i, '');
      fs.writeFileSync(destFile, zlib.gunzipSync(fs.readFileSync(fullPath)));
      fs.unlinkSync(fullPath);
    }
  }
}

// --- Paths -------------------------------------------------------------------

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
// Require the ZIP file name as a command line argument
const ZIP_ARG = process.argv[2];
if (!ZIP_ARG) {
  console.error(
    'Error: Please provide the Strava archive ZIP file as the first argument.',
  );
  console.error('Usage: node ./strava-to-kml.ts <your-archive.zip>');
  process.exit(1);
}
const MAIN_ZIP_PATH = path.join(__dirname, ZIP_ARG);
const TEMP_EXTRACTED_DIR = path.join(__dirname, 'strava-archiv-unzipped');
const TEMP_DIR = path.join(__dirname, 'strava-archiv-temp');
const OUTPUT_DIR = __dirname;

// --- KML helpers -------------------------------------------------------------

class Kml {
  static header(name: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://earth.google.com/kml/2.1"><Document><name>${name}</name>`;
  }

  static footer(): string {
    return '</Document></kml>\n';
  }

  static style(id: string, color: string): string {
    return `<Style id="${id}"><LineStyle><color>${color}</color><width>3</width></LineStyle></Style>`;
  }

  static folder(name: string, placemarks: string[]): string {
    return `<Folder><name>${name}</name>${placemarks.join('')}</Folder>`;
  }

  static placemark(
    name: string,
    description: string,
    styleId: string,
    coordinates: string,
  ): string {
    return `<Placemark><name>${name}</name>${description}<styleUrl>#${styleId}</styleUrl><LineString><tessellate>1</tessellate><coordinates>${coordinates}</coordinates></LineString></Placemark>`;
  }
}

// --- Color palette -----------------------------------------------------------

class ActivityColorMap {
  // KML color format: aabbggrr
  private static readonly palette = [
    'ff00ff00', // green
    'ffff0000', // blue
    'ff0000ff', // red
    'ff00ffff', // yellow
    'ffff00ff', // pink
    'ff888888', // gray
    'ffffff00', // cyan
    'ffff8000', // orange
    'ff8000ff', // violet
    'ff008080', // turquoise
  ];
  private static readonly map = new Map<string, string>();
  private static index = 0;

  static getColor(type: string | undefined): string {
    const key = type?.trim() || 'Other';
    if (!ActivityColorMap.map.has(key)) {
      const color =
        ActivityColorMap.palette[
          ActivityColorMap.index % ActivityColorMap.palette.length
        ] ?? 'ff888888';
      ActivityColorMap.map.set(key, color);
      ActivityColorMap.index++;
    }
    return ActivityColorMap.map.get(key)!;
  }
}

// --- Activity file parsers ---------------------------------------------------

class ActivityFileParser {
  /** Calculates the distance between two points on Earth (Haversine formula) */
  private static haversine(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const R = 6371000; // Earth radius in meters
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /** Removes GPS jumps larger than maxDist meters from a point sequence */
  private static filterJumps(points: Point[], maxDist = 5000): Point[] {
    const result: Point[] = [];
    let last: Point | undefined;
    for (const p of points) {
      if (
        !last ||
        ActivityFileParser.haversine(last.lat, last.lon, p.lat, p.lon) <=
          maxDist
      ) {
        result.push(p);
        last = p;
      }
    }
    return result;
  }

  static async extractCoordinatesFromGpx(filePath: string): Promise<string[]> {
    const parsed = await parseStringPromise(fs.readFileSync(filePath, 'utf-8'));
    const trkpts: { $: { lat: string; lon: string } }[] =
      parsed.gpx.trk?.[0]?.trkseg?.[0]?.trkpt ?? [];
    const coords = trkpts.map((pt) => `${pt.$.lon},${pt.$.lat}`).join(' ');
    return coords ? [coords] : [];
  }

  static async extractCoordinatesFromTcx(filePath: string): Promise<string[]> {
    const parsed = await parseStringPromise(fs.readFileSync(filePath, 'utf-8'));
    const laps =
      parsed.TrainingCenterDatabase?.Activities?.[0]?.Activity?.[0]?.Lap ?? [];
    const lapCoords: string[] = [];

    for (const lap of laps) {
      const points: Point[] = (lap.Track ?? []).flatMap((track: unknown) => {
        const t = track as Record<string, unknown[]>;
        return (t.Trackpoint ?? []).flatMap((pt: unknown) => {
          const p = pt as Record<string, unknown[]>;
          const pos = (p.Position as Record<string, string[]>[])?.[0];
          if (!pos?.LatitudeDegrees?.[0] || !pos?.LongitudeDegrees?.[0]) {
            return [];
          }
          const lat = parseFloat(pos.LatitudeDegrees[0]);
          const lon = parseFloat(pos.LongitudeDegrees[0]);
          if (isNaN(lat) || isNaN(lon)) {
            return [];
          }

          return [{ lat, lon, time: (p.Time as string[])?.[0] }];
        });
      });

      // Sort by time if available, then filter GPS jumps
      points.sort((a, b) =>
        a.time && b.time
          ? new Date(a.time).getTime() - new Date(b.time).getTime()
          : 0,
      );
      const filtered = ActivityFileParser.filterJumps(points);

      if (filtered.length > 1) {
        lapCoords.push(filtered.map((p) => `${p.lon},${p.lat}`).join(' '));
      }
    }
    return lapCoords;
  }

  static async extractStartTimeFromGpx(filePath: string): Promise<string> {
    const parsed = await parseStringPromise(fs.readFileSync(filePath, 'utf-8'));
    const timeStr =
      parsed.gpx.metadata?.[0]?.time?.[0] ??
      parsed.gpx.trk?.[0]?.trkseg?.[0]?.trkpt?.[0]?.time?.[0];
    return ActivityFileParser.formatDateTime(timeStr);
  }

  static async extractStartTimeFromTcx(filePath: string): Promise<string> {
    const parsed = await parseStringPromise(fs.readFileSync(filePath, 'utf-8'));
    const timeStr =
      parsed.TrainingCenterDatabase?.Activities?.[0]?.Activity?.[0]?.Lap?.[0]
        ?.Track?.[0]?.Trackpoint?.[0]?.Time?.[0] ??
      parsed.TrainingCenterDatabase?.Activities?.[0]?.Activity?.[0]?.Id?.[0];
    return ActivityFileParser.formatDateTime(timeStr);
  }

  private static formatDateTime(timeStr: string | undefined): string {
    if (!timeStr) {
      return 'unknown';
    }
    const date = new Date(timeStr);
    if (isNaN(date.getTime())) {
      return 'unknown';
    }
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${date.getFullYear()}_${pad(date.getMonth() + 1)}_${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}`;
  }
}

// --- Meta entry --------------------------------------------------------------

class ActivityMetaEntry {
  readonly fileName: string;
  readonly name: string;
  readonly type: string;
  readonly time: string;
  readonly distance: string;
  readonly elevation: string;
  readonly raw: Record<string, string>;

  private static _map = new Map<string, ActivityMetaEntry>();

  private constructor(
    fileName: string,
    name: string,
    type: string,
    time: string,
    distance: string,
    elevation: string,
    raw: Record<string, string>,
  ) {
    this.fileName = fileName;
    this.name = name;
    this.type = type;
    this.time = time;
    this.distance = distance;
    this.elevation = elevation;
    this.raw = raw;
  }

  static parse(csvPath: string): void {
    ActivityMetaEntry._map = new Map();
    if (!fs.existsSync(csvPath)) {
      return;
    }

    const content = fs.readFileSync(csvPath, 'utf-8');
    const headers = content.split(/\r?\n/)[0]?.split(',') ?? [];
    const records = parse(content, {
      columns: true,
      skip_empty_lines: true,
    }) as Record<string, string>[];

    for (const row of records) {
      let fileName = row[headers[12]!];
      if (!fileName) {
        continue;
      }
      fileName = fileName
        .replace(/^activities\//, '')
        .replaceAll('.gz', '')
        .trim();

      const entry = new ActivityMetaEntry(
        fileName,
        row[headers[2]!] ?? '',
        row[headers[3]!] ?? 'Other',
        row[headers[5]!] ?? '',
        row[headers[6]!] ?? '',
        row[headers[20]!] ?? '',
        row,
      );
      ActivityMetaEntry._map.set(fileName, entry);
    }
  }

  static getByFileName(fileName: string): ActivityMetaEntry | undefined {
    return ActivityMetaEntry._map.get(fileName);
  }

  buildDescription(): string {
    const parts = [
      this.formatDistance(),
      this.formatDuration(),
      this.formatElevation(),
    ].filter(Boolean);
    return parts.length
      ? `<description>${parts.join(' / ')}</description>`
      : '';
  }

  private formatDistance(): string {
    const m = parseFloat(this.distance.replace(',', '.'));
    return isNaN(m) || m <= 0 ? '' : `${(m / 1000).toFixed(1)} km`;
  }

  private formatDuration(): string {
    const sec = parseInt(this.time, 10);
    if (isNaN(sec) || sec < 0) {
      return '';
    }
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return [h, m, s].map((v) => v.toString().padStart(2, '0')).join(':');
  }

  private formatElevation(): string {
    const e = parseFloat(this.elevation.replace(',', '.'));
    return isNaN(e) ? '' : `${e.toFixed(0)} Hm`;
  }
}

// --- Helpers -----------------------------------------------------------------

function getAllActivityFiles(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.gpx') || f.endsWith('.tcx'))
    .map((f) => path.join(dir, f));
}

// --- Main --------------------------------------------------------------------

async function main() {
  // --- Extraction Step ---
  removeDirRecursive(TEMP_EXTRACTED_DIR);

  if (!fs.existsSync(MAIN_ZIP_PATH)) {
    console.error(`Error: ZIP file not found: ${MAIN_ZIP_PATH}`);
    process.exit(1);
  }

  console.log('Extracting archive...');
  removeDirRecursive(TEMP_DIR);
  fs.mkdirSync(TEMP_DIR);
  extractZip(MAIN_ZIP_PATH, TEMP_DIR);

  // Move extracted contents to final temp location
  fs.mkdirSync(TEMP_EXTRACTED_DIR, { recursive: true });
  for (const entry of fs.readdirSync(TEMP_DIR, { withFileTypes: true })) {
    fs.renameSync(
      path.join(TEMP_DIR, entry.name),
      path.join(TEMP_EXTRACTED_DIR, entry.name),
    );
  }
  removeDirRecursive(TEMP_DIR);

  // Decompress .gz activity files
  const activitiesDir = path.join(TEMP_EXTRACTED_DIR, 'activities');
  if (fs.existsSync(activitiesDir)) {
    extractGzFilesRecursively(activitiesDir);
  }

  // --- KML Generation Step ---
  console.log('Generating KML...');
  ActivityMetaEntry.parse(path.join(TEMP_EXTRACTED_DIR, 'activities.csv'));
  const files = getAllActivityFiles(activitiesDir);

  const folders = new Map<string, { placemarks: string[]; styleId: string }>();
  const styles: string[] = [];
  let processed = 0;

  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    const baseName = path.basename(file, ext);

    try {
      const isGpx = ext === '.gpx';
      const isTcx = ext === '.tcx';
      if (!isGpx && !isTcx) {
        continue;
      }

      const [coordinatesArr, datePrefix] = await Promise.all([
        isGpx
          ? ActivityFileParser.extractCoordinatesFromGpx(file)
          : ActivityFileParser.extractCoordinatesFromTcx(file),
        isGpx
          ? ActivityFileParser.extractStartTimeFromGpx(file)
          : ActivityFileParser.extractStartTimeFromTcx(file),
      ]);

      const metaEntry = ActivityMetaEntry.getByFileName(path.basename(file));
      const activityName = metaEntry?.name?.trim() || baseName;
      const type = metaEntry?.type?.trim() || 'Other';
      const description = metaEntry?.buildDescription() ?? '';

      if (!folders.has(type)) {
        const styleId = `s${folders.size + 1}`;
        styles.push(Kml.style(styleId, ActivityColorMap.getColor(type)));
        folders.set(type, { placemarks: [], styleId });
      }
      const folder = folders.get(type)!;

      // Create a Placemark for each lap
      for (const [idx, coordinates] of coordinatesArr.entries()) {
        const placemarkName =
          coordinatesArr.length > 1
            ? `${datePrefix}_${activityName} (Lap ${idx + 1})`
            : `${datePrefix}_${activityName}`;
        folder.placemarks.push(
          Kml.placemark(
            placemarkName,
            description,
            folder.styleId,
            coordinates,
          ),
        );
      }

      processed++;
    } catch (err) {
      console.warn(
        `Warning: Could not process ${path.basename(file)}: ${(err as Error).message}`,
      );
    }
  }

  const kmlFolders = [...folders.entries()]
    .map(([type, { placemarks }]) => Kml.folder(type, placemarks))
    .join('');

  const kmlContent = `${Kml.header('Strava Activities')}${styles.join('')}${kmlFolders}${Kml.footer()}`;
  fs.writeFileSync(path.join(OUTPUT_DIR, 'activities.kml'), kmlContent);

  console.log(
    `KML generation completed. ${processed} activities processed, grouped by type and colored.`,
  );

  // Remove the temporary extracted folder
  removeDirRecursive(TEMP_EXTRACTED_DIR);
}

main().catch(console.error);
