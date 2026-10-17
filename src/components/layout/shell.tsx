"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import * as Icons from "lucide-react";
import { Menu, X, LogOut, KeyRound, ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import type { NavGroup } from "./nav";

export function Logo({ name, light }: { name: string; light?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-500 text-lg font-black text-white shadow-sm" aria-hidden>
        {name.charAt(0).toUpperCase()}
      </span>
      <span className={cn("text-lg font-extrabold tracking-tight", light ? "text-white" : "text-ink")}>{name}</span>
    </span>
  );
}

export function Shell({ nav, user, company, logoutAction, children }: {
  nav: NavGroup[]; user: { name: string; email: string; role: string }; company: string;
  logoutAction: () => Promise<void>; children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  useEffect(() => { setOpen(false); setMenu(false); }, [pathname]);

  const sidebar = (
    <nav className="flex h-full flex-col bg-sidebar text-slate-300">
      <div className="flex h-16 items-center justify-between px-4">
        <Link href="/"><Logo name={company} light /></Link>
        <button className="lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu"><X className="h-5 w-5" /></button>
      </div>
      <div className="flex-1 space-y-5 overflow-y-auto px-3 pb-6 pt-2">
        {nav.map((g) => (
          <div key={g.label}>
            <p className="mb-1 px-3 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">{g.label}</p>
            <ul className="space-y-0.5">
              {g.items.map((i) => {
                const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[i.icon] ?? Icons.Circle;
                const active = pathname === i.href || pathname.startsWith(i.href + "/");
                return (
                  <li key={i.href}>
                    <Link href={i.href} className={cn("flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition",
                      active ? "bg-sidebar-active text-white shadow-sm" : "hover:bg-sidebar-hover hover:text-white")}>
                      <Icon className="h-4 w-4 shrink-0" />{i.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen lg:pl-64">
      <aside className="no-print fixed inset-y-0 left-0 z-40 hidden w-64 lg:block">{sidebar}</aside>
      {open && (
        <div className="no-print fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-ink/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw]">{sidebar}</aside>
        </div>
      )}
      <header className="no-print sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-line bg-white/95 px-4 backdrop-blur sm:px-6">
        <div className="flex items-center gap-3">
          <button className="rounded-md p-2 hover:bg-panel lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu"><Menu className="h-5 w-5" /></button>
          <div className="lg:hidden"><Logo name={company} /></div>
          <p className="hidden text-sm text-ink-soft lg:block"><span className="font-semibold text-ink">{company}</span> · Integrated ERP · Qatar</p>
        </div>
        <div className="relative">
          <button onClick={() => setMenu(!menu)} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-panel">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-brand-100 text-sm font-bold text-brand-700">{user.name.charAt(0).toUpperCase()}</span>
            <span className="hidden text-left sm:block">
              <span className="block text-sm font-semibold leading-tight">{user.name}</span>
              <span className="block text-xs text-ink-muted">{user.role}</span>
            </span>
            <ChevronDown className="h-4 w-4 text-ink-muted" />
          </button>
          {menu && (
            <div className="absolute right-0 mt-1 w-56 rounded-md border border-line bg-white py-1 shadow-lg">
              <p className="truncate border-b border-line px-3 py-2 text-xs text-ink-muted">{user.email}</p>
              <Link href="/account/password" className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-panel"><KeyRound className="h-4 w-4" /> Change password</Link>
              <form action={logoutAction}>
                <button className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50"><LogOut className="h-4 w-4" /> Sign out</button>
              </form>
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-[1500px] px-4 py-5 sm:px-6 sm:py-6">{children}</main>
    </div>
  );
}
