import { ShieldAlert } from "lucide-react";
import { LinkButton } from "@/components/ui/primitives";

export default function Forbidden() {
  return (
    <div className="card mx-auto mt-10 max-w-lg p-8 text-center">
      <ShieldAlert className="mx-auto h-10 w-10 text-amber-500" />
      <h1 className="mt-3 text-xl font-bold">Access restricted</h1>
      <p className="mt-2 text-sm text-ink-soft">Your role does not include permission to open this page. Ask your system administrator if you need access.</p>
      <div className="mt-5"><LinkButton href="/">Go to my home page</LinkButton></div>
    </div>
  );
}
