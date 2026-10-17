"use client";
import { Printer } from "lucide-react";
import { btn } from "./ui/primitives";

export function PrintButton({ label = "Print / PDF" }: { label?: string }) {
  return <button type="button" className={btn("outline")} onClick={() => window.print()}><Printer className="h-4 w-4" /> {label}</button>;
}
