/**
 * DEVELOPMENT-ONLY demo data for Chemtech ERP.
 *
 *  - Every record is FICTIONAL, coded "DEMO-…", named "… (Demo)" and flagged isDemo.
 *  - Refuses to run when NODE_ENV=production, and requires ALLOW_DEMO_SEED=1.
 *  - Demo user password comes from DEMO_PASSWORD (no default is ever used).
 *  - Transactions are created through the real service layer, so the stock
 *    ledger, approvals, reservations and document links are all consistent.
 *
 * Usage: ALLOW_DEMO_SEED=1 DEMO_PASSWORD='…' npm run db:seed:demo
 */
import { PrismaClient } from "@prisma/client";
import { seedBase } from "./seed-lib";
import { hashPassword, passwordProblem } from "../src/server/auth/password";
import type { Ctx } from "../src/server/context";
import * as Cust from "../src/server/services/customers";
import * as Sup from "../src/server/services/suppliers";
import * as Items from "../src/server/services/items";
import * as Inv from "../src/server/services/inventory";
import * as Sales from "../src/server/services/sales";
import * as Pur from "../src/server/services/purchasing";
import * as Fin from "../src/server/services/finance";

function refuse(msg: string): never { console.error(`✖ ${msg}`); process.exit(1); }
if (process.env.NODE_ENV === "production") refuse("Demo seed is disabled in production.");
if (process.env.ALLOW_DEMO_SEED !== "1") refuse("Set ALLOW_DEMO_SEED=1 to confirm you want fictional demo data in this database.");
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "";
const pwProblem = passwordProblem(DEMO_PASSWORD);
if (pwProblem) refuse(`DEMO_PASSWORD invalid: ${pwProblem}`);

const prisma = new PrismaClient();
const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString().slice(0, 10);

async function user(roleCode: string, name: string, email: string): Promise<Ctx> {
  const role = await prisma.role.findUniqueOrThrow({ where: { code: roleCode }, include: { permissions: true } });
  const u = await prisma.user.upsert({
    where: { email },
    create: { name, email, roleId: role.id, passwordHash: await hashPassword(DEMO_PASSWORD), department: role.name },
    update: {},
  });
  return { userId: u.id, userName: u.name, roleId: role.id, roleCode, permissions: new Set(role.permissions.map((p) => p.permission)) };
}

async function main() {
  if (await prisma.customer.findFirst({ where: { isDemo: true } })) {
    console.log("Demo data already present, nothing to do.");
    return;
  }
  await seedBase(prisma);

  const gm = await user("GENERAL_MANAGER", "Demo General Manager", "gm@chemtech.demo");
  const salesMgr = await user("SALES_MANAGER", "Demo Sales Manager", "sales.manager@chemtech.demo");
  const salesOff = await user("SALES_OFFICER", "Demo Sales Officer", "sales.officer@chemtech.demo");
  const procMgr = await user("PROCUREMENT_MANAGER", "Demo Procurement Manager", "procurement.manager@chemtech.demo");
  const procOff = await user("PROCUREMENT_OFFICER", "Demo Procurement Officer", "procurement.officer@chemtech.demo");
  const storeMgr = await user("STORE_MANAGER", "Demo Store Manager", "store.manager@chemtech.demo");
  const keeper = await user("STOREKEEPER", "Demo Storekeeper", "storekeeper@chemtech.demo");
  const fin = await user("FINANCE_OFFICER", "Demo Finance Officer", "finance@chemtech.demo");
  await user("AUDITOR", "Demo Auditor", "auditor@chemtech.demo");
  await user("SYSTEM_ADMIN", "Demo Administrator", "admin@chemtech.demo");

  // ── Warehouses
  const main = await prisma.warehouse.create({ data: { code: "DEMO-MAIN", name: "Main Store, Mesaieed (Demo)", address: "Fictional demo address", isDemo: true } });
  const rl = await prisma.warehouse.create({ data: { code: "DEMO-RL", name: "Ras Laffan Yard (Demo)", address: "Fictional demo address", isDemo: true } });
  for (const code of ["A-01", "A-02", "B-01", "CHEM-01", "TOOL-01"]) await prisma.warehouseLocation.create({ data: { warehouseId: main.id, code, name: `Demo bin ${code}` } });

  // ── Customers (fictional)
  const custDefs = [
    ["DEMO-C001", "Al Wakra Energy Operations (Demo)", "OPERATOR", 500000],
    ["DEMO-C002", "Dukhan Offshore Services (Demo)", "OPERATOR", 750000],
    ["DEMO-C003", "Gulf EPC Constructors (Demo)", "EPC_CONTRACTOR", 300000],
    ["DEMO-C004", "Pearl Industrial Gases (Demo)", "INDUSTRIAL", 150000],
    ["DEMO-C005", "Lusail Trading Company (Demo)", "TRADING", 100000],
    ["DEMO-C006", "North Field Process Contractors (Demo)", "EPC_CONTRACTOR", 400000],
  ] as const;
  const customers: { id: string }[] = [];
  for (const [code, legalName, category, creditLimit] of custDefs) {
    const r = await Cust.createCustomer(salesMgr, {
      code, legalName, category, creditLimit: String(creditLimit), paymentTerms: "30 days from invoice", paymentTermDays: 30,
      city: "Doha", address: "Fictional demo address, Doha", email: `${code.toLowerCase()}@example.invalid`, phone: "+974 0000 0000",
    }, { ignoreDuplicates: true });
    await prisma.customer.update({ where: { id: r.customer!.id }, data: { isDemo: true } });
    await Cust.addCustomerContact(salesMgr, r.customer!.id, { name: "Demo Contact", title: "Procurement Lead", email: `buyer.${code.toLowerCase()}@example.invalid`, isPrimary: true });
    customers.push(r.customer!);
  }

  // ── Suppliers (fictional)
  const supDefs = [
    ["DEMO-S001", "Apex Valve Manufacturing (Demo)", "MANUFACTURER", "Gate, ball and check valves; API 6A fittings", "USD"],
    ["DEMO-S002", "Meridian Chemicals FZE (Demo)", "DISTRIBUTOR", "Corrosion inhibitors, demulsifiers, scale inhibitors, biocides", "AED"],
    ["DEMO-S003", "Torque Wireline Tools Ltd (Demo)", "MANUFACTURER", "Slickline tool strings, jars, gauge cutters, wire", "GBP"],
    ["DEMO-S004", "Safeguard PPE Supplies (Demo)", "DISTRIBUTOR", "Coveralls, gloves, safety boots, H2S monitors", "QAR"],
    ["DEMO-S005", "Delta Pressure Control Inc (Demo)", "MANUFACTURER", "BOPs, lubricators, pressure control equipment and spares", "USD"],
  ] as const;
  const suppliers: { id: string }[] = [];
  for (const [code, legalName, category, productsServices, currency] of supDefs) {
    const r = await Sup.createSupplier(procMgr, { code, legalName, category, productsServices, currency, prequalStatus: "APPROVED", paymentTerms: "45 days", paymentTermDays: 45, rating: "4", email: `${code.toLowerCase()}@example.invalid` }, { ignoreDuplicates: true });
    await prisma.supplier.update({ where: { id: r.supplier!.id }, data: { isDemo: true } });
    suppliers.push(r.supplier!);
  }
  await Sup.addSupplierDocument(procMgr, suppliers[0].id, { docType: "ISO_9001", docNumber: "DEMO-ISO-001", issueDate: ago(700), expiryDate: ago(-25) });
  await Sup.addSupplierDocument(procMgr, suppliers[1].id, { docType: "HSE_CERTIFICATE", docNumber: "DEMO-HSE-77", issueDate: ago(400), expiryDate: ago(-300) });
  await Sup.addSupplierDocument(procMgr, suppliers[3].id, { docType: "TRADE_LICENSE", docNumber: "DEMO-TL-12", issueDate: ago(380), expiryDate: ago(10) });

  // ── Items
  const cat = Object.fromEntries((await prisma.itemCategory.findMany()).map((c) => [c.code, c.id]));
  const uom = Object.fromEntries((await prisma.unitOfMeasure.findMany()).map((u) => [u.code, u.id]));
  type ItemDef = { code: string; name: string; cat: string; type: string; cls?: string; uom: string; buy: number; sell: number; min: number; reorder: number; batch?: boolean; expiry?: boolean; haz?: boolean; sup: number; mfr?: string; mpn?: string };
  const itemDefs: ItemDef[] = [
    { code: "DEMO-CHM-001", name: "Corrosion inhibitor CI-200 (Demo)", cat: "CHEM", type: "CHEMICAL", uom: "DRUM", buy: 1450, sell: 2100, min: 10, reorder: 20, batch: true, expiry: true, haz: true, sup: 1 },
    { code: "DEMO-CHM-002", name: "Demulsifier DM-55 (Demo)", cat: "CHEM", type: "CHEMICAL", uom: "DRUM", buy: 1680, sell: 2450, min: 8, reorder: 16, batch: true, expiry: true, haz: true, sup: 1 },
    { code: "DEMO-CHM-003", name: "Scale inhibitor SI-10 (Demo)", cat: "CHEM", type: "CHEMICAL", uom: "PAIL", buy: 320, sell: 510, min: 30, reorder: 60, batch: true, expiry: true, sup: 1 },
    { code: "DEMO-CHM-004", name: "Biocide BX-7 (Demo)", cat: "CHEM", type: "CHEMICAL", uom: "IBC", buy: 5200, sell: 7400, min: 2, reorder: 4, batch: true, expiry: true, haz: true, sup: 1 },
    { code: "DEMO-VLV-001", name: '2" gate valve API 6A 5K (Demo)', cat: "VALVE", type: "SPARE_PART", uom: "EA", buy: 4200, sell: 6100, min: 4, reorder: 6, sup: 0, mfr: "Apex (Demo)", mpn: "APX-GV2-5K" },
    { code: "DEMO-VLV-002", name: '1/2" needle valve SS316 (Demo)', cat: "VALVE", type: "SPARE_PART", uom: "EA", buy: 185, sell: 290, min: 20, reorder: 50, sup: 0 },
    { code: "DEMO-SPR-001", name: "Lubricator O-ring seal kit (Demo)", cat: "SPARE", type: "SPARE_PART", uom: "SET", buy: 640, sell: 980, min: 10, reorder: 20, sup: 4 },
    { code: "DEMO-SLK-001", name: "Slickline spang jar 1.5\" (Demo)", cat: "SLICK", type: "EQUIPMENT", cls: "SERIALIZED_ASSET", uom: "EA", buy: 18500, sell: 26500, min: 1, reorder: 2, sup: 2, mfr: "Torque (Demo)", mpn: "TWT-SJ15" },
    { code: "DEMO-SLK-002", name: "Slickline wire 0.108\" 25,000 ft (Demo)", cat: "SLICK", type: "CONSUMABLE", uom: "EA", buy: 9800, sell: 13900, min: 2, reorder: 3, sup: 2 },
    { code: "DEMO-PCE-001", name: "Wireline BOP 4-1/16\" 10K (Demo)", cat: "PCE", type: "EQUIPMENT", cls: "RENTAL", uom: "EA", buy: 145000, sell: 210000, min: 0, reorder: 0, sup: 4 },
    { code: "DEMO-WT-001", name: "Test separator pressure gauge kit (Demo)", cat: "WT", type: "EQUIPMENT", uom: "SET", buy: 3100, sell: 4650, min: 2, reorder: 4, sup: 4 },
    { code: "DEMO-PPE-001", name: "FR coverall, size L (Demo)", cat: "PPE", type: "CONSUMABLE", uom: "PCS", buy: 95, sell: 145, min: 100, reorder: 200, sup: 3 },
    { code: "DEMO-PPE-002", name: "Portable H2S gas monitor (Demo)", cat: "PPE", type: "PRODUCT", uom: "EA", buy: 1150, sell: 1690, min: 10, reorder: 15, sup: 3 },
    { code: "DEMO-CON-001", name: "Thread compound, 5 kg (Demo)", cat: "CONS", type: "CONSUMABLE", uom: "PAIL", buy: 210, sell: 330, min: 15, reorder: 30, sup: 0 },
    { code: "DEMO-SRV-001", name: "Slickline crew & unit, per day (Demo)", cat: "SERV", type: "SERVICE", uom: "DAY", buy: 0, sell: 18500, min: 0, reorder: 0, sup: 2 },
    { code: "DEMO-SRV-002", name: "Chemical injection field service (Demo)", cat: "SERV", type: "SERVICE", uom: "JOB", buy: 0, sell: 7500, min: 0, reorder: 0, sup: 1 },
  ];
  const items: Record<string, { id: string; def: ItemDef }> = {};
  for (const d of itemDefs) {
    const it = await Items.createItem(storeMgr, {
      code: d.code, name: d.name, categoryId: cat[d.cat], itemType: d.type, inventoryClass: d.cls ?? "STOCK", uomId: uom[d.uom], purchasePrice: String(d.buy), sellingPrice: String(d.sell),
      minStockLevel: String(d.min), reorderQty: String(d.reorder), batchTracked: !!d.batch, expiryTracked: !!d.expiry, hazardous: !!d.haz,
      preferredSupplierId: suppliers[d.sup].id, defaultWarehouseId: main.id, manufacturer: d.mfr, manufacturerPartNo: d.mpn,
    });
    await prisma.item.update({ where: { id: it.id }, data: { isDemo: true } });
    items[d.code] = { id: it.id, def: d };
  }
  const I = (code: string) => items[code].id;

  // ── Opening balances (prepared by storekeeper, approved by GM: above store manager limit)
  const opening = await Inv.createStockDocument(keeper, {
    type: "OPENING", warehouseId: main.id, date: ago(300), reason: "Opening balance on go-live (Demo)", lines: [
      { itemId: I("DEMO-CHM-001"), quantity: "24", unitCost: "1450", batchNo: "DEMO-CI-2501", expiryDate: ago(-420) },
      { itemId: I("DEMO-CHM-002"), quantity: "14", unitCost: "1680", batchNo: "DEMO-DM-2502", expiryDate: ago(-200) },
      { itemId: I("DEMO-CHM-003"), quantity: "40", unitCost: "320", batchNo: "DEMO-SI-2490", expiryDate: ago(-40) },
      { itemId: I("DEMO-CHM-004"), quantity: "3", unitCost: "5200", batchNo: "DEMO-BX-2510", expiryDate: ago(-500) },
      { itemId: I("DEMO-VLV-001"), quantity: "8", unitCost: "4200" },
      { itemId: I("DEMO-VLV-002"), quantity: "60", unitCost: "185" },
      { itemId: I("DEMO-SPR-001"), quantity: "18", unitCost: "640" },
      { itemId: I("DEMO-SLK-001"), quantity: "2", unitCost: "18500", serialNos: "DEMO-SJ-1001, DEMO-SJ-1002" },
      { itemId: I("DEMO-SLK-002"), quantity: "4", unitCost: "9800" },
      { itemId: I("DEMO-PCE-001"), quantity: "1", unitCost: "145000", serialNos: "DEMO-BOP-7001" },
      { itemId: I("DEMO-WT-001"), quantity: "5", unitCost: "3100" },
      { itemId: I("DEMO-PPE-001"), quantity: "260", unitCost: "95" },
      { itemId: I("DEMO-PPE-002"), quantity: "22", unitCost: "1150" },
      { itemId: I("DEMO-CON-001"), quantity: "35", unitCost: "210" },
    ],
  });
  await Inv.postStockDocument(gm, opening.id);
  const rlOpen = await Inv.createStockDocument(keeper, { type: "OPENING", warehouseId: rl.id, date: ago(300), reason: "Opening balance Ras Laffan (Demo)", lines: [{ itemId: I("DEMO-PPE-001"), quantity: "80", unitCost: "95" }, { itemId: I("DEMO-VLV-002"), quantity: "25", unitCost: "185" }] });
  await Inv.postStockDocument(storeMgr, rlOpen.id);

  // ── Procurement history: PO → approve → GRN, spread across months
  async function po(supplier: number, daysAgo: number, expectedIn: number, lines: { code: string; qty: number; price: number }[], opts: { currency?: string; freight?: number; receive?: "full" | "partial" | "none"; reject?: number } = {}) {
    const order = await Pur.savePurchaseOrder(procOff, null, {
      supplierId: suppliers[supplier].id, warehouseId: main.id, date: ago(daysAgo), expectedDate: ago(daysAgo - expectedIn), currency: opts.currency ?? "QAR",
      freight: String(opts.freight ?? 0), paymentTerms: "45 days", deliveryTerms: "DAP Mesaieed",
      lines: lines.map((l) => ({ itemId: I(l.code), description: items[l.code].def.name, quantity: String(l.qty), unitPrice: String(l.price) })),
    });
    await Pur.purchaseOrderAction(procOff, order.id, "submit");
    const approver = Number(order.total) * Number(order.exchangeRate) > 250000 ? gm : procMgr;
    await Pur.purchaseOrderAction(approver, order.id, "approve");
    if (opts.receive === "none") return order;
    const pol = await prisma.purchaseOrderLine.findMany({ where: { orderId: order.id }, orderBy: { lineNo: "asc" } });
    const grn = await Pur.createGoodsReceipt(keeper, {
      purchaseOrderId: order.id, date: ago(Math.max(daysAgo - expectedIn - (opts.reject ? 2 : 0), 1)), supplierDeliveryNote: `DEMO-DN-${daysAgo}`,
      lines: pol.map((l, i) => {
        const d = items[lines[i].code].def;
        const qty = opts.receive === "partial" ? Math.ceil(Number(l.quantity) / 2) : Number(l.quantity);
        return {
          poLineId: l.id, receivedQty: String(qty), rejectedQty: i === 0 && opts.reject ? String(opts.reject) : "0", rejectionReason: i === 0 && opts.reject ? "Damaged drums on arrival (Demo)" : undefined,
          batchNo: d.batch ? `DEMO-B${daysAgo}${i}` : undefined, expiryDate: d.expiry ? ago(-365) : undefined, certificateNo: d.batch ? `DEMO-COA-${daysAgo}${i}` : undefined,
        };
      }),
    });
    await Pur.postGoodsReceipt(keeper, grn.id);
    return order;
  }
  await po(1, 270, 14, [{ code: "DEMO-CHM-001", qty: 20, price: 1420 }, { code: "DEMO-CHM-002", qty: 10, price: 1650 }], { freight: 1800 });
  await po(0, 240, 21, [{ code: "DEMO-VLV-001", qty: 6, price: 1150 }, { code: "DEMO-VLV-002", qty: 40, price: 50 }], { currency: "USD", freight: 2400 });
  await po(3, 200, 7, [{ code: "DEMO-PPE-001", qty: 200, price: 92 }, { code: "DEMO-PPE-002", qty: 12, price: 1120 }]);
  await po(1, 160, 14, [{ code: "DEMO-CHM-003", qty: 60, price: 315 }, { code: "DEMO-CHM-004", qty: 2, price: 5150 }], { reject: 4 });
  await po(4, 120, 30, [{ code: "DEMO-SPR-001", qty: 20, price: 175 }, { code: "DEMO-WT-001", qty: 4, price: 850 }], { currency: "USD" });
  await po(2, 90, 28, [{ code: "DEMO-SLK-002", qty: 3, price: 2050 }], { currency: "GBP", freight: 900 });
  await po(1, 45, 14, [{ code: "DEMO-CHM-001", qty: 16, price: 1460 }], { receive: "partial" });
  await po(0, 40, 20, [{ code: "DEMO-VLV-001", qty: 4, price: 1160 }], { currency: "USD", receive: "none" }); // overdue delivery
  await po(3, 10, 12, [{ code: "DEMO-PPE-002", qty: 10, price: 1140 }], { receive: "none" }); // upcoming delivery

  // Draft PO awaiting approval + PR awaiting approval
  const pendingPo = await Pur.savePurchaseOrder(procOff, null, { supplierId: suppliers[4].id, warehouseId: main.id, expectedDate: ago(-30), lines: [{ itemId: I("DEMO-SPR-001"), description: items["DEMO-SPR-001"].def.name, quantity: "15", unitPrice: "650" }] });
  await Pur.purchaseOrderAction(procOff, pendingPo.id, "submit");
  const pr = await Pur.savePurchaseRequest(storeMgr, null, { department: "Store", justification: "Replenish thread compound and needle valves for Q4 jobs (Demo)", requiredDate: ago(-21), lines: [{ itemId: I("DEMO-CON-001"), description: items["DEMO-CON-001"].def.name, quantity: "30", estimatedUnitPrice: "210" }, { itemId: I("DEMO-VLV-002"), description: items["DEMO-VLV-002"].def.name, quantity: "50", estimatedUnitPrice: "185" }] });
  await Pur.purchaseRequestAction(storeMgr, pr.id, "submit");

  // RFQ with two offers for comparison
  const prApproved = await Pur.savePurchaseRequest(salesOff, null, { justification: "Biocide for customer injection campaign (Demo)", lines: [{ itemId: I("DEMO-CHM-004"), description: items["DEMO-CHM-004"].def.name, quantity: "4", estimatedUnitPrice: "5200" }] });
  await Pur.purchaseRequestAction(salesOff, prApproved.id, "submit");
  await Pur.purchaseRequestAction(procMgr, prApproved.id, "approve");
  const prLine = await prisma.purchaseRequestLine.findFirstOrThrow({ where: { requestId: prApproved.id } });
  const rfq = await Pur.createRfq(procOff, { title: "Biocide BX-7 × 4 IBC (Demo)", purchaseRequestId: prApproved.id, dueDate: ago(-5), supplierIds: [suppliers[1].id, suppliers[3].id], lines: [{ prLineId: prLine.id, itemId: I("DEMO-CHM-004"), description: items["DEMO-CHM-004"].def.name, quantity: "4", uom: "IBC" }] });
  await Pur.rfqAction(procOff, rfq.id, "send");
  const rfqLine = await prisma.rfqLine.findFirstOrThrow({ where: { rfqId: rfq.id } });
  const crit = await prisma.evaluationCriterion.findMany();
  await Pur.saveSupplierQuotation(procOff, null, { rfqId: rfq.id, supplierId: suppliers[1].id, supplierRef: "DEMO-MC-Q-881", currency: "AED", deliveryDays: 21, paymentTerms: "45 days", technicalCompliance: "COMPLIANT", lines: [{ rfqLineId: rfqLine.id, itemId: I("DEMO-CHM-004"), description: "Biocide BX-7 IBC", quantity: "4", unitPrice: "5150" }], scores: crit.map((c, i) => ({ criterionId: c.id, score: [8, 7, 9, 7, 8][i] ?? 7 })) });
  await Pur.saveSupplierQuotation(procOff, null, { rfqId: rfq.id, supplierId: suppliers[3].id, supplierRef: "DEMO-SG-221", currency: "QAR", deliveryDays: 10, paymentTerms: "30 days", technicalCompliance: "PARTIAL", lines: [{ rfqLineId: rfqLine.id, itemId: I("DEMO-CHM-004"), description: "Biocide equivalent", quantity: "4", unitPrice: "5300" }], scores: crit.map((c, i) => ({ criterionId: c.id, score: [7, 9, 6, 6, 7][i] ?? 6 })) });

  // ── Sales history: quotation → SO → reserve → deliver → invoice → pay
  async function sale(cust: number, daysAgo: number, lines: { code: string; qty: number; disc?: number }[], opts: { deliver?: "full" | "partial" | "none"; invoice?: boolean; pay?: "full" | "partial" | "none"; viaQuote?: boolean } = {}) {
    const lineData = lines.map((l) => ({ itemId: I(l.code), description: items[l.code].def.name, quantity: String(l.qty), unitPrice: String(items[l.code].def.sell), discountPct: String(l.disc ?? 0) }));
    let soId: string;
    if (opts.viaQuote) {
      const q = await Sales.saveQuotation(salesOff, null, { customerId: customers[cust].id, date: ago(daysAgo + 7), validUntil: ago(daysAgo - 23), reference: `DEMO-ENQ-${daysAgo}`, paymentTerms: "30 days", deliveryTerms: "DAP site", lines: lineData });
      await Sales.quotationAction(salesOff, q.id, "submit");
      await Sales.quotationAction(salesMgr, q.id, "approve");
      await Sales.quotationAction(salesOff, q.id, "send");
      await Sales.quotationAction(salesOff, q.id, "accept");
      soId = (await Sales.convertQuotationToOrder(salesOff, q.id, main.id)).id;
      await prisma.salesOrder.update({ where: { id: soId }, data: { date: new Date(ago(daysAgo)), customerPoRef: `DEMO-PO-${daysAgo}` } });
    } else {
      soId = (await Sales.saveSalesOrder(salesOff, null, { customerId: customers[cust].id, warehouseId: main.id, date: ago(daysAgo), customerPoRef: `DEMO-PO-${daysAgo}`, requiredDate: ago(daysAgo - 10), paymentTerms: "30 days", lines: lineData })).id;
    }
    await Sales.salesOrderAction(salesOff, soId, "submit");
    const so = await prisma.salesOrder.findUniqueOrThrow({ where: { id: soId } });
    await Sales.salesOrderAction(Number(so.total) > 500000 ? gm : salesMgr, soId, "approve");
    await Sales.reserveOrderStock(salesOff, soId);
    if (opts.deliver === "none") return soId;
    const sol = await prisma.salesOrderLine.findMany({ where: { orderId: soId }, orderBy: { lineNo: "asc" } });
    const serialFor = (code: string) => (code === "DEMO-SLK-001" ? "DEMO-SJ-1001" : code === "DEMO-PCE-001" ? "DEMO-BOP-7001" : undefined);
    const dlv = await Sales.createDelivery(keeper, {
      salesOrderId: soId, date: ago(Math.max(daysAgo - 5, 1)), vehicleNo: "DEMO-123", driverName: "Demo Driver",
      lines: sol.map((l, i) => ({ salesOrderLineId: l.id, quantity: String(opts.deliver === "partial" && i === 0 ? Math.max(1, Math.floor(Number(l.quantity) / 2)) : Number(l.quantity)), serialNos: serialFor(lines[i].code) })),
    });
    await Sales.postDelivery(keeper, dlv.id);
    if (!opts.invoice) return soId;
    const inv = await Fin.invoiceableLines(soId);
    const invoice = await Fin.createSalesInvoice(fin, { salesOrderId: soId, date: ago(Math.max(daysAgo - 6, 1)), lines: inv.filter((x) => x.invoiceable.gt(0)).map((x) => ({ salesOrderLineId: x.line.id, quantity: x.invoiceable.toString() })) });
    await Fin.postSalesInvoice(fin, invoice.id);
    const fresh = await prisma.salesInvoice.findUniqueOrThrow({ where: { id: invoice.id } });
    if (opts.pay === "full") await Fin.recordCustomerPayment(fin, { invoiceId: invoice.id, amount: fresh.total.toString(), date: ago(Math.max(daysAgo - 35, 1)), reference: `DEMO-TT-${daysAgo}` });
    if (opts.pay === "partial") await Fin.recordCustomerPayment(fin, { invoiceId: invoice.id, amount: fresh.total.div(2).toFixed(2), date: ago(Math.max(daysAgo - 30, 1)), reference: `DEMO-TT-${daysAgo}` });
    return soId;
  }
  await sale(0, 250, [{ code: "DEMO-CHM-001", qty: 10 }, { code: "DEMO-SRV-002", qty: 2 }], { viaQuote: true, invoice: true, pay: "full" });
  await sale(1, 220, [{ code: "DEMO-VLV-001", qty: 3, disc: 5 }, { code: "DEMO-VLV-002", qty: 30 }], { invoice: true, pay: "full" });
  await sale(2, 190, [{ code: "DEMO-PPE-001", qty: 150 }, { code: "DEMO-PPE-002", qty: 8 }], { viaQuote: true, invoice: true, pay: "full" });
  await sale(1, 150, [{ code: "DEMO-SRV-001", qty: 6 }, { code: "DEMO-SLK-002", qty: 2 }], { invoice: true, pay: "full" });
  await sale(3, 130, [{ code: "DEMO-CHM-003", qty: 45 }], { invoice: true, pay: "partial" });
  await sale(5, 100, [{ code: "DEMO-CHM-002", qty: 12 }, { code: "DEMO-SRV-002", qty: 1 }], { viaQuote: true, invoice: true, pay: "none" }); // overdue
  await sale(0, 70, [{ code: "DEMO-SLK-001", qty: 1 }, { code: "DEMO-SPR-001", qty: 6 }], { invoice: true, pay: "full" });
  await sale(4, 50, [{ code: "DEMO-PPE-001", qty: 120, disc: 3 }, { code: "DEMO-CON-001", qty: 10 }], { invoice: true, pay: "none" });
  await sale(1, 30, [{ code: "DEMO-PCE-001", qty: 1 }, { code: "DEMO-SRV-001", qty: 4 }], { invoice: true, pay: "none" }); // rental BOP
  await sale(2, 20, [{ code: "DEMO-CHM-001", qty: 14 }, { code: "DEMO-WT-001", qty: 2 }], { deliver: "partial" });
  await sale(5, 8, [{ code: "DEMO-CHM-004", qty: 6 }], { deliver: "none" }); // shortage → alert

  // Quotations in various states
  const q1 = await Sales.saveQuotation(salesOff, null, { customerId: customers[3].id, validUntil: ago(-20), reference: "DEMO-ENQ-PIPE", lines: [{ itemId: I("DEMO-VLV-002"), description: items["DEMO-VLV-002"].def.name, quantity: "40", unitPrice: "290" }] });
  await Sales.quotationAction(salesOff, q1.id, "submit");
  const q2 = await Sales.saveQuotation(salesOff, null, { customerId: customers[4].id, validUntil: ago(-10), lines: [{ itemId: I("DEMO-PPE-002"), description: items["DEMO-PPE-002"].def.name, quantity: "15", unitPrice: "1690" }] });
  await Sales.quotationAction(salesOff, q2.id, "submit"); await Sales.quotationAction(salesMgr, q2.id, "approve"); await Sales.quotationAction(salesOff, q2.id, "send");
  const q3 = await Sales.saveQuotation(salesOff, null, { customerId: customers[2].id, date: ago(60), validUntil: ago(30), lines: [{ itemId: I("DEMO-SRV-001"), description: items["DEMO-SRV-001"].def.name, quantity: "10", unitPrice: "18500" }] });
  await Sales.quotationAction(salesOff, q3.id, "submit"); await Sales.quotationAction(salesMgr, q3.id, "approve"); await Sales.quotationAction(salesOff, q3.id, "send"); await Sales.quotationAction(salesOff, q3.id, "reject", "Price too high (Demo)");
  await Sales.saveQuotation(salesOff, null, { customerId: customers[0].id, lines: [{ itemId: I("DEMO-CHM-003"), description: items["DEMO-CHM-003"].def.name, quantity: "20", unitPrice: "510" }] });

  // Inventory: transfer + an adjustment awaiting approval
  const tr = await Inv.createStockDocument(keeper, { type: "TRANSFER", warehouseId: main.id, toWarehouseId: rl.id, date: ago(15), reason: "Stock for Ras Laffan job (Demo)", lines: [{ itemId: I("DEMO-SPR-001"), quantity: "4" }] });
  await Inv.postStockDocument(keeper, tr.id);
  await Inv.createStockDocument(keeper, { type: "ADJUSTMENT", warehouseId: main.id, reason: "Damaged coveralls found during inspection (Demo)", lines: [{ itemId: I("DEMO-PPE-001"), quantity: "-6" }] });

  // Supplier invoice with matching
  const recvPo = await prisma.purchaseOrder.findFirstOrThrow({ where: { supplierId: suppliers[3].id, status: "RECEIVED" }, include: { lines: true } });
  const pinv = await Fin.createPurchaseInvoice(fin, { purchaseOrderId: recvPo.id, supplierInvoiceNo: "DEMO-SG-INV-5501", date: ago(185), lines: recvPo.lines.map((l) => ({ poLineId: l.id, quantity: l.receivedQty.toString(), unitPrice: l.quantity.gt(0) ? l.lineTotal.div(l.quantity).toFixed(2) : "0" })) });
  await Fin.postPurchaseInvoice(fin, pinv.id);

  console.log("Demo data created. Demo users (password from DEMO_PASSWORD):");
  console.log((await prisma.user.findMany({ where: { email: { endsWith: "@chemtech.demo" } }, include: { role: true } })).map((u) => `  ${u.email.padEnd(38)} ${u.role.name}`).join("\n"));
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
