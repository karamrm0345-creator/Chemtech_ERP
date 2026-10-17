"use client";
import { useState } from "react";
import { saveMasterAction, saveLocationAction } from "@/app/actions/masterdata";
import { useAction } from "@/components/forms/use-action";
import { btn, Card } from "@/components/ui/primitives";

type R = { id: string; code: string; name: string; address?: string; active: boolean };

export function MasterEditor({ kind, title, rows: initial, withAddress }: { kind: "warehouse" | "category" | "uom"; title: string; rows: R[]; withAddress?: boolean }) {
  const { run, pending } = useAction();
  const [rows, setRows] = useState(initial);
  const [n, setN] = useState<R>({ id: "", code: "", name: "", address: "", active: true });
  const upd = (i: number, p: Partial<R>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  return (
    <Card title={title} bodyClass="p-0">
      <div className="overflow-x-auto">
        <table className="table-base">
          <thead><tr><th>Code</th><th>Name</th>{withAddress && <th>Address</th>}<th>Active</th><th /></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id}>
                <td><input className="input w-28 py-1 font-mono uppercase" value={r.code} onChange={(e) => upd(i, { code: e.target.value })} /></td>
                <td><input className="input py-1" value={r.name} onChange={(e) => upd(i, { name: e.target.value })} /></td>
                {withAddress && <td><input className="input py-1" value={r.address} onChange={(e) => upd(i, { address: e.target.value })} /></td>}
                <td><input type="checkbox" checked={r.active} onChange={(e) => upd(i, { active: e.target.checked })} /></td>
                <td><button className={btn("outline", "py-1 text-xs")} disabled={pending} onClick={() => run(() => saveMasterAction(kind, r.id, r))}>Save</button></td>
              </tr>
            ))}
            <tr className="bg-panel/40">
              <td><input className="input w-28 py-1 font-mono uppercase" placeholder="CODE" value={n.code} onChange={(e) => setN({ ...n, code: e.target.value })} /></td>
              <td><input className="input py-1" placeholder="Name" value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} /></td>
              {withAddress && <td><input className="input py-1" placeholder="Address" value={n.address} onChange={(e) => setN({ ...n, address: e.target.value })} /></td>}
              <td />
              <td><button className={btn("primary", "py-1 text-xs")} disabled={pending || !n.code || !n.name} onClick={async () => {
                const r = await run(() => saveMasterAction(kind, null, n));
                if (r?.ok) { setRows([...rows, { ...(r.data as R), name: n.name, address: n.address, active: true }]); setN({ id: "", code: "", name: "", address: "", active: true }); }
              }}>Add</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  );
}

type W = { id: string; code: string; locations: { id: string; code: string; name: string; active: boolean }[] };

export function LocationEditor({ warehouses }: { warehouses: W[] }) {
  const { run, pending } = useAction();
  const [wid, setWid] = useState(warehouses[0]?.id ?? "");
  const [n, setN] = useState({ code: "", name: "" });
  const w = warehouses.find((x) => x.id === wid);
  return (
    <Card title="Bin locations" actions={
      <select className="input w-auto py-1 text-xs" value={wid} onChange={(e) => setWid(e.target.value)} aria-label="Warehouse">
        {warehouses.map((x) => <option key={x.id} value={x.id}>{x.code}</option>)}
      </select>} bodyClass="p-0">
      {!w ? <p className="p-4 text-sm text-ink-muted">Create a warehouse first.</p> : (
        <table className="table-base">
          <thead><tr><th>Location code</th><th>Description</th><th>Active</th></tr></thead>
          <tbody>
            {w.locations.map((l) => <tr key={l.id}><td className="font-mono">{l.code}</td><td>{l.name}</td><td>{l.active ? "Yes" : "No"}</td></tr>)}
            <tr className="bg-panel/40">
              <td><input className="input py-1 font-mono uppercase" placeholder="e.g. A-01-03" value={n.code} onChange={(e) => setN({ ...n, code: e.target.value })} /></td>
              <td><input className="input py-1" placeholder="Rack / shelf" value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} /></td>
              <td><button className={btn("primary", "py-1 text-xs")} disabled={pending || !n.code} onClick={async () => { if (await run(() => saveLocationAction(wid, null, n))) setN({ code: "", name: "" }); }}>Add</button></td>
            </tr>
          </tbody>
        </table>
      )}
    </Card>
  );
}
