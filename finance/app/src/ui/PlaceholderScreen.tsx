type PlaceholderScreenProps = {
  title: string;
  phase: string;
  purpose: string;
};

export function PlaceholderScreen({
  title,
  phase,
  purpose,
}: PlaceholderScreenProps) {
  return (
    <section className="page">
      <p className="text-sm font-medium tracking-wide text-accent uppercase">
        {phase}
      </p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">
        {title}
      </h1>
      <p className="mt-3 max-w-[34ch] text-base text-muted">{purpose}</p>
    </section>
  );
}
