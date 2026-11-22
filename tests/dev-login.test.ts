import { describe, expect, it } from "vitest";

import { devLoginAllowed } from "@/lib/dev-login";

/** Umgebung des Produktions-Builds der Mock-Umgebung (scripts/mock.mjs start). */
const E2E_PROD: NodeJS.ProcessEnv = {
  NODE_ENV: "production",
  E2E_PRODUCTION_DEV_LOGIN: "mock-only",
  DATABASE_URL: "postgresql://u:p@localhost:5432/familytree_e2ebuild_mock",
  MEDIA_DIR: "C:\\Dev\\familiy-tree\\data\\media-mock",
};

describe("devLoginAllowed", () => {
  it("erlaubt außerhalb von Produktion (Dev-Server, Tests)", () => {
    expect(devLoginAllowed({ NODE_ENV: "development" })).toBe(true);
    expect(devLoginAllowed({ NODE_ENV: "test" })).toBe(true);
  });

  it("sperrt in Produktion ohne die E2E-Freigabe — auch mit Mock-Datenbank", () => {
    expect(devLoginAllowed({ ...E2E_PROD, E2E_PRODUCTION_DEV_LOGIN: undefined })).toBe(false);
    expect(devLoginAllowed({ ...E2E_PROD, E2E_PRODUCTION_DEV_LOGIN: "1" })).toBe(false);
    expect(devLoginAllowed({ ...E2E_PROD, E2E_PRODUCTION_DEV_LOGIN: "true" })).toBe(false);
  });

  it("erlaubt in Produktion nur mit Freigabe, Mock-Datenbank und Mock-Medienordner", () => {
    expect(devLoginAllowed(E2E_PROD)).toBe(true);
    expect(devLoginAllowed({ ...E2E_PROD, DATABASE_URL: "postgresql://u:p@db:5432/x_test" })).toBe(true);
    expect(devLoginAllowed({ ...E2E_PROD, MEDIA_DIR: "/tmp/media-test/" })).toBe(true);
  });

  it("sperrt die echte Datenbank trotz Freigabe", () => {
    for (const url of [
      "postgresql://u:p@db:5432/familytree",
      "postgresql://u:p@db:5432/familytree_mock_old",
      "postgresql://u:p@db:5432/mock",
      "postgresql://u:p@db:5432/familytree?schema=familytree_mock",
      "kein-url",
      undefined,
    ]) {
      expect(devLoginAllowed({ ...E2E_PROD, DATABASE_URL: url }), String(url)).toBe(false);
    }
  });

  it("sperrt den echten Medienordner trotz Freigabe", () => {
    for (const dir of ["/data/media", "./data/media", "/data/media-mock/fotos", "", undefined]) {
      expect(devLoginAllowed({ ...E2E_PROD, MEDIA_DIR: dir }), String(dir)).toBe(false);
    }
  });
});
