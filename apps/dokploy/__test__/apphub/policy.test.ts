import { afterEach, describe, expect, it, vi } from "vitest";
import { globalDockerCleanupAllowed, requireGlobalDockerCleanup } from "../../../../packages/server/src/services/apphub-policy";

afterEach(() => vi.unstubAllEnvs());
describe("shared Docker cluster cleanup policy", () => {
    it.each([undefined, "false", "1", "TRUE", ""]) ("blocks prune unless deliberately enabled: %s", (value) => {
        vi.stubEnv("APPHUB_ALLOW_GLOBAL_DOCKER_PRUNE", value);
        expect(globalDockerCleanupAllowed()).toBe(false);
        expect(requireGlobalDockerCleanup).toThrow("全局 Docker 清理");
    });
    it("allows the explicit operator setting", () => {
        vi.stubEnv("APPHUB_ALLOW_GLOBAL_DOCKER_PRUNE", "true");
        expect(requireGlobalDockerCleanup).not.toThrow();
    });
});
