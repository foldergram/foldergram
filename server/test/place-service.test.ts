import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

type ConfigModule = typeof import('../src/config/env.js');
type PlaceServiceModule = typeof import('../src/services/place-service.js');
type RepositoriesModule = typeof import('../src/db/repositories.js');

interface TestGeonamesCity {
  geonameId: number;
  name: string;
  latitude: number;
  longitude: number;
  countryCode?: string;
  admin1Code?: string;
  admin1Name?: string;
  population?: number;
  featureCode?: string;
  timezone?: string;
}

function createGeonamesDatabase(databasePath: string): DatabaseSync {
  const database = new DatabaseSync(databasePath);
  database.exec(`
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

  return database;
}

function insertGeonamesCity(database: DatabaseSync, city: TestGeonamesCity) {
  database
    .prepare(`
      INSERT INTO geonames_places (
        geoname_id, name, ascii_name, latitude, longitude, country_code, admin1_code,
        admin1_name, population, feature_class, feature_code, timezone
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      city.geonameId,
      city.name,
      city.name,
      city.latitude,
      city.longitude,
      city.countryCode ?? 'GB',
      city.admin1Code ?? 'ENG',
      city.admin1Name ?? 'England',
      city.population ?? 0,
      'P',
      city.featureCode ?? 'PPL',
      city.timezone ?? 'Europe/London'
    );
}

describe.sequential('place resolution service', () => {
  let tempRoot = '';
  let placeResolutionService: PlaceServiceModule['placeResolutionService'];
  let geodataService: PlaceServiceModule['geodataService'];
  let imageRepository: RepositoriesModule['imageRepository'];
  let placeRepository: RepositoriesModule['placeRepository'];
  let appConfig: ConfigModule['appConfig'];

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'insta-place-service-'));

    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DATA_ROOT', path.join(tempRoot, 'data'));
    vi.stubEnv('GALLERY_ROOT', path.join(tempRoot, 'gallery'));
    vi.stubEnv('DB_DIR', path.join(tempRoot, 'db'));
    vi.stubEnv('THUMBNAILS_DIR', path.join(tempRoot, 'thumbnails'));
    vi.stubEnv('PREVIEWS_DIR', path.join(tempRoot, 'previews'));

    vi.resetModules();

    ({ appConfig } = await import('../src/config/env.js'));
    ({ placeResolutionService, geodataService } = await import('../src/services/place-service.js'));
    ({imageRepository, placeRepository} = await import('../src/db/repositories.js'));
    await (await import('../src/db/repositories.js')).initRepositories();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(appConfig.geodataDir, { recursive: true, force: true });
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('clears stale place assignments when reverse geocoding finds no nearby city', async () => {
    vi.spyOn(geodataService, 'isPrepared').mockReturnValue(true);
    vi.spyOn(geodataService, 'findNearestCity').mockReturnValue(null);
    const assignPlaceSpy = vi.spyOn(imageRepository, 'assignPlace').mockImplementation(() => undefined);

    const place = await placeResolutionService.resolveImage({
      id: 42,
      exif_json: JSON.stringify({
        latitude: 31.582,
        longitude: 74.329
      })
    });

    expect(place).toBeNull();
    expect(assignPlaceSpy).toHaveBeenCalledWith(42, null);
  });

  it('keeps existing place assignments when offline geodata is not prepared', async () => {
    const findNearestCitySpy = vi.spyOn(geodataService, 'findNearestCity');
    const assignPlaceSpy = vi.spyOn(imageRepository, 'assignPlace').mockImplementation(() => undefined);

    const place = await placeResolutionService.resolveImage({
      id: 43,
      exif_json: JSON.stringify({
        latitude: 31.582,
        longitude: 74.329
      })
    });

    expect(place).toBeNull();
    expect(findNearestCitySpy).not.toHaveBeenCalled();
    expect(assignPlaceSpy).not.toHaveBeenCalled();
  });

  it('selects the nearest city before using population as a tie breaker', async () => {
    await fs.mkdir(appConfig.geodataDir, { recursive: true });
    const database = new DatabaseSync(appConfig.geodataPath);
    try {
      database.exec(`
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
      for (let index = 0; index < 140; index += 1) {
        insert.run(
          1000 + index,
          `Large City ${index}`,
          `Large City ${index}`,
          0.18 + index * 0.0001,
          0,
          'PK',
          '04',
          'Punjab',
          1_000_000 - index,
          'P',
          'PPL',
          'Asia/Karachi'
        );
      }
      insert.run(9999, 'Nearby Town', 'Nearby Town', 0.01, 0, 'PK', '04', 'Punjab', 500, 'P', 'PPL', 'Asia/Karachi');
    } finally {
      database.close();
    }

    const city = geodataService.findNearestCity(0, 0);

    expect(city?.geonameId).toBe(9999);
    expect(city?.asciiName).toBe('Nearby Town');
  });

  it('prefers a nearby major city over a slightly closer city section', async () => {
    await fs.mkdir(appConfig.geodataDir, { recursive: true });
    const database = createGeonamesDatabase(appConfig.geodataPath);
    try {
      insertGeonamesCity(database, {
        geonameId: 2634283,
        name: 'Whitechapel',
        latitude: 51.5138,
        longitude: -0.0658,
        countryCode: 'GB',
        admin1Name: 'England',
        population: 0,
        featureCode: 'PPLX'
      });
      insertGeonamesCity(database, {
        geonameId: 2643743,
        name: 'London',
        latitude: 51.5085,
        longitude: -0.1257,
        countryCode: 'GB',
        admin1Name: 'England',
        population: 7_556_900,
        featureCode: 'PPLC'
      });
    } finally {
      database.close();
    }

    const city = geodataService.findNearestCity(51.504105, -0.074575);

    expect(city?.geonameId).toBe(2643743);
    expect(city?.asciiName).toBe('London');
  });

  it('keeps a very close local place instead of widening to the nearest major city', async () => {
    await fs.mkdir(appConfig.geodataDir, { recursive: true });
    const database = createGeonamesDatabase(appConfig.geodataPath);
    try {
      insertGeonamesCity(database, {
        geonameId: 6697563,
        name: 'Arashiyama',
        latitude: 35.0148,
        longitude: 135.6775,
        countryCode: 'JP',
        admin1Name: 'Kyoto',
        population: 50_000,
        featureCode: 'PPLX',
        timezone: 'Asia/Tokyo'
      });
      insertGeonamesCity(database, {
        geonameId: 1857910,
        name: 'Kyoto',
        latitude: 35.0211,
        longitude: 135.7538,
        countryCode: 'JP',
        admin1Name: 'Kyoto',
        population: 1_459_640,
        featureCode: 'PPLA',
        timezone: 'Asia/Tokyo'
      });
    } finally {
      database.close();
    }

    const city = geodataService.findNearestCity(35.014377, 135.669015);

    expect(city?.geonameId).toBe(6697563);
    expect(city?.asciiName).toBe('Arashiyama');
  });

  it('updates existing place rows instead of reusing stale metadata', async () => {
    vi.spyOn(geodataService, 'isPrepared').mockReturnValue(true);
    vi.spyOn(geodataService, 'findNearestCity').mockReturnValue({
      geonameId: 1172451,
      name: 'Lahore',
      asciiName: 'Lahore',
      latitude: 31.558,
      longitude: 74.35,
      countryCode: 'PK',
      countryName: 'Pakistan',
      admin1Code: '04',
      admin1Name: 'Punjab',
      population: 6310888,
      featureClass: 'P',
      featureCode: 'PPLA',
      timezone: 'Asia/Karachi',
      distanceKm: 2.1
    });
    const upsertCitySpy = vi.spyOn(placeRepository, 'upsertCity').mockReturnValue({
      id: 7,
      slug: 'lahore',
      display_name: 'Lahore',
      kind: 'city',
      source: 'offline_city',
      source_confidence: 0.95,
      provider: 'geonames',
      provider_place_id: '1172451',
      latitude: 31.558,
      longitude: 74.35,
      city_name: 'Lahore',
      admin1_name: 'Punjab',
      country_name: 'Pakistan',
      country_code: 'PK',
      geonames_id: 1172451,
      is_approximate: 1,
      name_override: null,
      description: null,
      created_at: '2026-04-24T00:00:00.000Z',
      updated_at: '2026-04-24T00:00:00.000Z'
    });
    const assignPlaceSpy = vi.spyOn(imageRepository, 'assignPlace').mockImplementation(() => undefined);

    const place = await placeResolutionService.resolveImage({
      id: 11,
      exif_json: JSON.stringify({
        latitude: 31.56,
        longitude: 74.33
      })
    });

    expect(upsertCitySpy).toHaveBeenCalledOnce();
    expect(assignPlaceSpy).toHaveBeenCalledWith(11, 7);
    expect(place).toMatchObject({
      slug: 'lahore',
      name: 'Lahore'
    });
  });

  it('normalizes legacy coded region and country fields in place detail payloads', async () => {
    const detail = placeResolutionService.placeDetail({
      id: 9,
      slug: 'dera-ismail-khan',
      display_name: 'Dera Ismail Khan',
      kind: 'city',
      source: 'offline_city',
      source_confidence: 0.44,
      provider: 'geonames',
      provider_place_id: '1175662',
      latitude: 31.8313,
      longitude: 70.9017,
      city_name: 'Dera Ismail Khan',
      admin1_name: '03',
      country_name: 'PK',
      country_code: 'PK',
      geonames_id: 1175662,
      is_approximate: 1,
      name_override: null,
      description: null,
      created_at: '2026-04-24T00:00:00.000Z',
      updated_at: '2026-04-24T00:00:00.000Z'
    }, 63);

    expect(detail.admin1Name).toBeNull();
    expect(detail.countryName).toBe('Pakistan');
    expect(detail.postCount).toBe(63);
  });
});
