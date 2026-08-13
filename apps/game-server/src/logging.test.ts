import { afterEach, describe, expect, it } from "vitest";
import { buildApp, type AppDependencies } from "./app.js";
import { createSafeLoggerOptions } from "./logging.js";

const openedApps: Awaited<ReturnType<typeof buildApp>>[] = [];

afterEach(async () => {
  await Promise.all(openedApps.splice(0).map((app) => app.close()));
});

describe("safe Fastify request logging", () => {
  it("does not write a bearer value or token query parameter", async () => {
    const records: string[] = [];
    const bearer = "release-audit-bearer-secret";
    const app = await buildApp({
      auth: {} as AppDependencies["auth"],
      rooms: {} as AppDependencies["rooms"],
      store: {} as AppDependencies["store"],
      gateway: {} as AppDependencies["gateway"],
      hub: {} as AppDependencies["hub"],
      devAuthEnabled: false,
      logger: createSafeLoggerOptions("info", { write: (message) => records.push(message) }),
    });
    openedApps.push(app);

    await app.inject({ method: "GET", url: `/health/live?token=${bearer}` });

    const output = records.join("");
    expect(output).toContain('"url":"/health/live"');
    expect(output).not.toContain(bearer);
    expect(output).not.toContain("?token=");
  });
});
