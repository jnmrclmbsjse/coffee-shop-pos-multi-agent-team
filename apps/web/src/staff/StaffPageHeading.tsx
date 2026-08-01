export function StaffPageHeading({
  headingId,
  title,
  description,
  badge,
}: {
  headingId?: string;
  title: string;
  description: string;
  badge?: string;
}) {
  return (
    <header className="staff-inventory-page-heading">
      <div>
        <h1 id={headingId}>{title}</h1>
        <p>{description}</p>
      </div>
      {badge && <span className="staff-page-heading-badge">{badge}</span>}
    </header>
  );
}
