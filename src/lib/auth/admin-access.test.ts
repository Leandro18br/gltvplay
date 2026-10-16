import { describe, expect, it, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/auth/session-vault", () => ({ ensureSlot: async () => {} }));
import { roleToAccess } from "./admin-access";

const user = { id: "u1" } as never;
describe("admin access", () => {
  it("allows staff roles", () => {
    for (const r of ["super_admin", "admin", "editor"]) expect(roleToAccess(user, r).status).toBe("ok");
  });
  it("denies regular users", () => {
    expect(roleToAccess(user, "user").status).toBe("forbidden");
  });
});
