import { buildLeadProfileSections } from "@/modules/crm/leads/presentation";

export function LeadProfilePresentation({ profile }: { profile: unknown }) {
  const sections = buildLeadProfileSections(profile);
  if (sections.length === 0) {
    return <p className="mt-4 text-sm text-[var(--text-secondary)]">暂无 AI 画像</p>;
  }

  return (
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      {sections.map((section) => (
        <section className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-muted)] p-4" key={section.title}>
          <h3 className="text-sm font-medium text-[var(--text-primary)]">{section.title}</h3>
          {section.kind === "list" ? (
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-6 text-[var(--text-secondary)]">
              {section.values.map((value) => <li key={value}>{value}</li>)}
            </ul>
          ) : (
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--text-secondary)]">{section.values.join("；")}</p>
          )}
        </section>
      ))}
    </div>
  );
}
