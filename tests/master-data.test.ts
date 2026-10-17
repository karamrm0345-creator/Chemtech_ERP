import { describe, expect, it } from "vitest";
import { createCustomer, listCustomers } from "@/server/services/customers";
import { createSupplier, getSupplier, listSuppliers } from "@/server/services/suppliers";
import { ctxFor, uid } from "./helpers";

describe("Customers", () => {
  it("[T1] creates a customer that appears in the customer list", async () => {
    const ctx = await ctxFor("SALES_OFFICER");
    const name = `Gulf Operator ${uid()}`;
    const r = await createCustomer(ctx, { legalName: name, category: "OPERATOR", email: `${uid("ops").toLowerCase()}@example.test` });
    expect(r.customer?.code).toMatch(/^CUS-\d{5}$/);
    const list = await listCustomers(ctx, { q: name });
    expect(list.rows.map((c) => c.id)).toContain(r.customer!.id);
  });

  it("warns about duplicates instead of silently creating them", async () => {
    const ctx = await ctxFor("SALES_OFFICER");
    const name = `Duplicate Test ${uid()} WLL`;
    await createCustomer(ctx, { legalName: name });
    const second = await createCustomer(ctx, { legalName: name.replace(" WLL", " W.L.L.") });
    expect(second.customer).toBeNull();
    expect(second.duplicates.length).toBeGreaterThan(0);
  });

  it("rejects customer creation by a user without permission", async () => {
    const ctx = await ctxFor("STOREKEEPER");
    await expect(createCustomer(ctx, { legalName: "Nope" })).rejects.toThrow(/permission/i);
  });
});

describe("Suppliers", () => {
  it("[T2] creates a supplier that appears in the supplier list", async () => {
    const ctx = await ctxFor("PROCUREMENT_OFFICER");
    const name = `Valve Maker ${uid()}`;
    const r = await createSupplier(ctx, { legalName: name, category: "MANUFACTURER" });
    expect(r.supplier?.code).toMatch(/^SUP-\d{5}$/);
    const list = await listSuppliers(ctx, { q: name });
    expect(list.rows.map((s) => s.id)).toContain(r.supplier!.id);
  });

  it("protects bank details by role", async () => {
    const admin = await ctxFor("PROCUREMENT_OFFICER");
    const gm = await ctxFor("GENERAL_MANAGER");
    const withBank = { ...admin, permissions: new Set([...admin.permissions, "supplier.bank.manage"]) };
    const r = await createSupplier(withBank, { legalName: `Bank Test ${uid()}`, iban: "QA00TEST000000000000000001" }, { ignoreDuplicates: true });
    const officerView = await getSupplier(admin, r.supplier!.id);
    expect(officerView.iban).toBe("••••••");
    const gmView = await getSupplier(gm, r.supplier!.id);
    expect(gmView.iban).toBe("QA00TEST000000000000000001");
  });

  it("ignores bank fields from users without supplier.bank.manage", async () => {
    const ctx = await ctxFor("PROCUREMENT_OFFICER");
    const r = await createSupplier(ctx, { legalName: `NoBank ${uid()}`, iban: "QA99HACK" }, { ignoreDuplicates: true });
    expect(r.supplier!.iban).toBeNull();
  });
});
