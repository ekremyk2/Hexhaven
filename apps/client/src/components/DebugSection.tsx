// Raw-state debug block (T-301 §6): proves the message -> store wiring end to end until the real
// screens (T-401+) replace it. The JSON dump is diagnostic data, not user-facing copy — only the
// title goes through strings.ts.
export function DebugSection({ title, value }: { title: string; value: unknown }) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">{title}</h2>
      <pre className="overflow-x-auto rounded-md bg-gray-900 p-3 text-xs text-gray-100">
        {JSON.stringify(value, null, 2)}
      </pre>
    </section>
  );
}
