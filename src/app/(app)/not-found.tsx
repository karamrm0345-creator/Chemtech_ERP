import { LinkButton } from "@/components/ui/primitives";

export default function NotFound() {
  return (
    <div className="card mx-auto mt-10 max-w-lg p-8 text-center">
      <h1 className="text-xl font-bold">Record not found</h1>
      <p className="mt-2 text-sm text-ink-soft">It may have been removed, or the link is incorrect.</p>
      <div className="mt-5"><LinkButton href="/">Back to home</LinkButton></div>
    </div>
  );
}
