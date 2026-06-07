import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';

import { appConfig } from '../config/env.js';
import { imageRepository, placeRepository } from '../db/repositories.js';
import type { ImageRecord, PlaceDetail, PlaceRecord, PlaceSummary } from '../types/models.js';
import { deserializeImageExifData } from '../utils/exif-utils.js';
import { resolveUniqueSlug, slugifyFolderName } from '../utils/slug.js';
import { log } from './log-service.js';

const GEONAMES_URL = 'https://download.geonames.org/export/dump/cities500.zip';
const ADMIN1_CODES_URL = 'https://download.geonames.org/export/dump/admin1CodesASCII.txt';
const MAX_CITY_DISTANCE_KM = 50;
const LOCAL_PLACE_MATCH_DISTANCE_KM = 1;
const MAJOR_CITY_PREFERENCE_DISTANCE_KM = 8;
const MAJOR_CITY_MAX_EXTRA_DISTANCE_KM = 5;
const MAJOR_CITY_MIN_POPULATION = 100_000;
const EARTH_RADIUS_KM = 6371;
const MAJOR_CITY_FEATURE_CODES = new Set(['PPLC', 'PPLA']);
const regionDisplayNames = (() => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' });
  } catch {
    return null;
  }
})();

interface GeonamesCity {
  geonameId: number;
  name: string;
  asciiName: string;
  latitude: number;
  longitude: number;
  countryCode: string | null;
  countryName: string | null;
  admin1Code: string | null;
  admin1Name: string | null;
  population: number;
  featureClass: string | null;
  featureCode: string | null;
  timezone: string | null;
  distanceKm?: number;
}

interface GeodataMetadata {
  source: string;
  sourceUrl: string;
  importedAt: string;
  rowCount: number;
}

function isCodeLikePlaceLabel(value: string): boolean {
  return /^\d+$/.test(value) || (value.length <= 4 && /^[A-Z0-9-]+$/.test(value));
}

function normalizeAdmin1Name(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0 || isCodeLikePlaceLabel(trimmed)) {
    return null;
  }

  return trimmed;
}

function getCountryDisplayName(countryCode: string | null | undefined): string | null {
  if (typeof countryCode !== 'string') {
    return null;
  }

  const normalizedCode = countryCode.trim().toUpperCase();
  if (normalizedCode.length === 0 || !regionDisplayNames) {
    return null;
  }

  try {
    return regionDisplayNames.of(normalizedCode) ?? null;
  } catch {
    return null;
  }
}

function normalizeCountryName(countryName: string | null | undefined, countryCode: string | null | undefined): string | null {
  const normalizedCode = typeof countryCode === 'string' ? countryCode.trim().toUpperCase() : '';
  const trimmedName = typeof countryName === 'string' ? countryName.trim() : '';

  if (
    trimmedName.length > 0 &&
    trimmedName.toUpperCase() !== normalizedCode &&
    !isCodeLikePlaceLabel(trimmedName)
  ) {
    return trimmedName;
  }

  return getCountryDisplayName(normalizedCode) ?? (trimmedName || null);
}

function toPlaceSummary(place: PlaceRecord): PlaceSummary {
  return {
    id: place.id,
    slug: place.slug,
    name: place.name_override ?? place.display_name,
    kind: place.kind,
    isApproximate: place.is_approximate === 1
  };
}

function toPlaceDetail(place: PlaceRecord, postCount: number): PlaceDetail {
  return {
    ...toPlaceSummary(place),
    latitude: place.latitude,
    longitude: place.longitude,
    cityName: place.city_name,
    admin1Name: normalizeAdmin1Name(place.admin1_name),
    countryName: normalizeCountryName(place.country_name, place.country_code),
    countryCode: place.country_code,
    description: place.description,
    postCount
  };
}

function haversineDistanceKm(latitudeA: number, longitudeA: number, latitudeB: number, longitudeB: number): number {
  const toRadians = (value: number) => value * Math.PI / 180;
  const deltaLatitude = toRadians(latitudeB - latitudeA);
  const deltaLongitude = toRadians(longitudeB - longitudeA);
  const a =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(toRadians(latitudeA)) * Math.cos(toRadians(latitudeB)) * Math.sin(deltaLongitude / 2) ** 2;

  return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getDistanceKm(city: GeonamesCity): number {
  return city.distanceKm ?? Number.POSITIVE_INFINITY;
}

function isMajorCityCandidate(city: GeonamesCity): boolean {
  return city.population >= MAJOR_CITY_MIN_POPULATION || MAJOR_CITY_FEATURE_CODES.has(city.featureCode ?? '');
}

function getMajorCityScore(city: GeonamesCity): number {
  const distance = getDistanceKm(city);
  const populationBonus = Math.min(3, Math.max(0, Math.log10(Math.max(city.population, 1)) - 4));
  const featureBonus = city.featureCode === 'PPLC' ? 1.25 : city.featureCode === 'PPLA' ? 0.65 : 0;

  return distance - populationBonus - featureBonus;
}

function selectBestCity(candidates: GeonamesCity[]): GeonamesCity | null {
  const nearest =
    candidates
      .filter((candidate) => getDistanceKm(candidate) <= MAX_CITY_DISTANCE_KM)
      .sort((left, right) => getDistanceKm(left) - getDistanceKm(right) || right.population - left.population)[0] ?? null;

  if (!nearest || getDistanceKm(nearest) <= LOCAL_PLACE_MATCH_DISTANCE_KM) {
    return nearest;
  }

  const nearestDistance = getDistanceKm(nearest);
  const preferredMajorCity =
    candidates
      .filter((candidate) => {
        const distance = getDistanceKm(candidate);

        return (
          isMajorCityCandidate(candidate) &&
          distance <= MAJOR_CITY_PREFERENCE_DISTANCE_KM &&
          distance <= nearestDistance + MAJOR_CITY_MAX_EXTRA_DISTANCE_KM
        );
      })
      .sort((left, right) => getMajorCityScore(left) - getMajorCityScore(right) || getDistanceKm(left) - getDistanceKm(right))[0] ?? null;

  return preferredMajorCity ?? nearest;
}

function readFirstZipTextFile(buffer: Buffer): string {
  const signature = buffer.readUInt32LE(0);
  if (signature !== 0x04034b50) {
    return buffer.toString('utf8');
  }

  const compressionMethod = buffer.readUInt16LE(8);
  const compressedSize = buffer.readUInt32LE(18);
  const uncompressedSize = buffer.readUInt32LE(22);
  const fileNameLength = buffer.readUInt16LE(26);
  const extraLength = buffer.readUInt16LE(28);
  const dataStart = 30 + fileNameLength + extraLength;
  const dataEnd = compressedSize > 0 ? dataStart + compressedSize : buffer.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), dataStart);
  const compressed = buffer.subarray(dataStart, dataEnd > dataStart ? dataEnd : undefined);
  const raw = compressionMethod === 8 ? inflateRawSync(compressed) : compressed;

  if (uncompressedSize > 0 && raw.length < uncompressedSize) {
    throw new Error('GeoNames zip file could not be fully decompressed.');
  }

  return raw.toString('utf8');
}

function parseAdmin1Rows(text: string): Map<string, string> {
  const rows = new Map<string, string>();

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith('#')) {
      continue;
    }

    const columns = line.split('\t');
    const code = columns[0]?.trim();
    const asciiName = columns[2]?.trim();
    const name = columns[1]?.trim();
    if (!code) {
      continue;
    }

    const displayName = asciiName || name;
    if (displayName) {
      rows.set(code, displayName);
    }
  }

  return rows;
}

function parseGeonamesRows(text: string, admin1Names: Map<string, string>): GeonamesCity[] {
  const rows: GeonamesCity[] = [];

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    const columns = line.split('\t');
    const geonameId = Number(columns[0]);
    const latitude = Number(columns[4]);
    const longitude = Number(columns[5]);
    if (!Number.isInteger(geonameId) || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      continue;
    }

    rows.push({
      geonameId,
      name: columns[1] ?? '',
      asciiName: columns[2] ?? columns[1] ?? '',
      latitude,
      longitude,
      featureClass: columns[6] || null,
      featureCode: columns[7] || null,
      countryCode: columns[8] || null,
      countryName: normalizeCountryName(null, columns[8] || null),
      admin1Code: columns[10] || null,
      admin1Name: normalizeAdmin1Name(admin1Names.get(`${columns[8] || ''}.${columns[10] || ''}`) ?? null),
      population: Number(columns[14] ?? 0) || 0,
      timezone: columns[17] || null
    });
  }

  return rows;
}

function openGeodataDatabase(readonly = true): DatabaseSync | null {
  if (!fs.existsSync(appConfig.geodataPath)) {
    return null;
  }

  return new DatabaseSync(appConfig.geodataPath, { readOnly: readonly });
}

export const geodataService = {
  isPrepared() {
    return fs.existsSync(appConfig.geodataPath);
  },

  getStatus() {
    let metadata: GeodataMetadata | null = null;
    if (fs.existsSync(appConfig.geodataMetadataPath)) {
      try {
        metadata = JSON.parse(fs.readFileSync(appConfig.geodataMetadataPath, 'utf8')) as GeodataMetadata;
      } catch {
        metadata = null;
      }
    }

    return {
      prepared: this.isPrepared(),
      databasePath: appConfig.geodataPath,
      metadata
    };
  },

  async prepare(): Promise<ReturnType<typeof this.getStatus>> {
    await fsPromises.mkdir(appConfig.geodataDir, { recursive: true });
    const [citiesResponse, admin1Response] = await Promise.all([
      fetch(GEONAMES_URL),
      fetch(ADMIN1_CODES_URL)
    ]);
    if (!citiesResponse.ok) {
      throw new Error(`Unable to download GeoNames cities500.zip (${citiesResponse.status}).`);
    }
    if (!admin1Response.ok) {
      throw new Error(`Unable to download GeoNames admin1 codes (${admin1Response.status}).`);
    }

    const [zipBuffer, admin1Text] = await Promise.all([
      citiesResponse.arrayBuffer(),
      admin1Response.text()
    ]);
    const cities = parseGeonamesRows(
      readFirstZipTextFile(Buffer.from(zipBuffer)),
      parseAdmin1Rows(admin1Text)
    );
    const tempPath = `${appConfig.geodataPath}.tmp`;
    await fsPromises.rm(tempPath, { force: true });

    const database = new DatabaseSync(tempPath);
    try {
      database.exec(`
        PRAGMA journal_mode = DELETE;
        CREATE TABLE geonames_places (
          geoname_id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          ascii_name TEXT NOT NULL,
          latitude REAL NOT NULL,
          longitude REAL NOT NULL,
          country_code TEXT NULL,
          admin1_code TEXT NULL,
          admin1_name TEXT NULL,
          population INTEGER NOT NULL DEFAULT 0,
          feature_class TEXT NULL,
          feature_code TEXT NULL,
          timezone TEXT NULL
        );
      `);

      const insert = database.prepare(`
        INSERT INTO geonames_places (
          geoname_id, name, ascii_name, latitude, longitude, country_code, admin1_code,
          admin1_name, population, feature_class, feature_code, timezone
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      database.exec('BEGIN');
      for (const city of cities) {
        insert.run(
          city.geonameId,
          city.name,
          city.asciiName,
          city.latitude,
          city.longitude,
          city.countryCode,
          city.admin1Code,
          city.admin1Name,
          city.population,
          city.featureClass,
          city.featureCode,
          city.timezone
        );
      }
      database.exec('COMMIT');
      database.exec(`
        CREATE INDEX idx_geonames_places_latitude ON geonames_places(latitude);
        CREATE INDEX idx_geonames_places_longitude ON geonames_places(longitude);
        CREATE INDEX idx_geonames_places_country_code ON geonames_places(country_code);
      `);
    } catch (error) {
      try {
        database.exec('ROLLBACK');
      } catch {
        // Ignore rollback failures after an implicit commit.
      }
      throw error;
    } finally {
      database.close();
    }

    await fsPromises.rm(appConfig.geodataPath, { force: true });
    await fsPromises.rename(tempPath, appConfig.geodataPath);
    await fsPromises.writeFile(
      appConfig.geodataMetadataPath,
      JSON.stringify({
        source: 'GeoNames cities500',
        sourceUrl: GEONAMES_URL,
        importedAt: new Date().toISOString(),
        rowCount: cities.length
      }, null, 2)
    );

    return this.getStatus();
  },

  findNearestCity(latitude: number, longitude: number): GeonamesCity | null {
    const database = openGeodataDatabase();
    if (!database) {
      return null;
    }

    try {
      const latitudeWindow = MAX_CITY_DISTANCE_KM / 111;
      const longitudeWindow = MAX_CITY_DISTANCE_KM / Math.max(20, Math.cos(latitude * Math.PI / 180) * 111);
      const candidates = database
        .prepare(
          `
          SELECT
            geoname_id AS geonameId,
            name,
            ascii_name AS asciiName,
            latitude,
            longitude,
            country_code AS countryCode,
            admin1_code AS admin1Code,
            admin1_name AS admin1Name,
            population,
            feature_class AS featureClass,
            feature_code AS featureCode,
            timezone
          FROM geonames_places
          WHERE latitude BETWEEN ? AND ?
            AND longitude BETWEEN ? AND ?
          `
        )
        .all(latitude - latitudeWindow, latitude + latitudeWindow, longitude - longitudeWindow, longitude + longitudeWindow) as unknown as GeonamesCity[];

      return selectBestCity(candidates
        .map((candidate) => ({
          ...candidate,
          countryName: normalizeCountryName(candidate.countryName, candidate.countryCode),
          admin1Name: normalizeAdmin1Name(candidate.admin1Name),
          distanceKm: haversineDistanceKm(latitude, longitude, candidate.latitude, candidate.longitude)
        }))
      );
    } finally {
      database.close();
    }
  }
};

export const placeResolutionService = {
  placeSummary: toPlaceSummary,
  placeDetail: toPlaceDetail,

  async resolveImage(image: Pick<ImageRecord, 'id' | 'exif_json'>): Promise<PlaceSummary | null> {
    const exif = deserializeImageExifData(image.exif_json);
    if (
      typeof exif?.latitude !== 'number' ||
      !Number.isFinite(exif.latitude) ||
      typeof exif.longitude !== 'number' ||
      !Number.isFinite(exif.longitude)
    ) {
      await imageRepository.assignPlace(image.id, null);
      return null;
    }

    if (!geodataService.isPrepared()) {
      return null;
    }

    let city: GeonamesCity | null;
    try {
      city = geodataService.findNearestCity(exif.latitude, exif.longitude);
    } catch (error) {
      log.info('Unable to query offline place data', {
        imageId: image.id,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }

    if (!city) {
      await imageRepository.assignPlace(image.id, null);
      return null;
    }

    const existing = await placeRepository.getByGeonamesId(city.geonameId);
    const allSlugs = await placeRepository.getAllSlugs();
    const place = await placeRepository.upsertCity({
      geonamesId: city.geonameId,
      displayName: city.asciiName || city.name,
      slug: existing?.slug ?? resolveUniqueSlug(city.asciiName || city.name, new Set(allSlugs), slugifyFolderName),
      latitude: city.latitude,
      longitude: city.longitude,
      cityName: city.asciiName || city.name,
      admin1Name: city.admin1Name,
      countryName: city.countryName,
      countryCode: city.countryCode,
      confidence: city.distanceKm === undefined ? null : Math.max(0, 1 - city.distanceKm / MAX_CITY_DISTANCE_KM)
    });

    await imageRepository.assignPlace(image.id, place.id);
    return toPlaceSummary(place);
  },

  async rebuildAssignments(batchSize = 250) {
    let afterId = 0;
    let processed = 0;
    let assigned = 0;
    let skipped = 0;

    for (;;) {
      const rows = await imageRepository.listWithExifForPlaceRebuild(afterId, batchSize);
      if (rows.length === 0) {
        break;
      }

      for (const row of rows) {
        afterId = row.id;
        processed += 1;
        try {
          const place = await this.resolveImage(row);
          if (place) {
            assigned += 1;
          } else {
            skipped += 1;
          }
        } catch (error) {
          skipped += 1;
          log.info('Unable to resolve image place', {
            imageId: row.id,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    }

    return {
      processed,
      assigned,
      skipped
    };
  }
};
