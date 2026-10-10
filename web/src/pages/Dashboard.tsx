import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, type Band } from "../api";
import { ErrorState, Loading, OutcomeBar, PageHeader } from "../components/ui";
import { BAND_LABEL, GRADE_LABEL, categoryLabel, count, percent } from "../format";

const BANDS: Band[] = ["high", "medium", "low"];

export function DashboardPage() {
  const query = useQuery({ queryKey: ["dashboard"], queryFn: api.dashboard });
  if (query.isPending) return <Loading label="Loading dashboard" />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const { totals, byPriority, byCategory, grades, workload } = query.data;
  const priority = Object.fromEntries(byPriority.map((p) => [p.band, p.count])) as Partial<Record<Band, number>>;
  const maxPriority = Math.max(1, ...BANDS.map((b) => priority[b] ?? 0));
  const maxCategory = Math.max(1, ...byCategory.map((c) => c.open));
  const maxWorkload = Math.max(1, ...workload.map((w) => w.open));
  const graded = Object.fromEntries(grades.map((g) => [g.grade, g.count]));
  const tp = graded.true_positive ?? 0;
  const bp = graded.benign_positive ?? 0;
  const fp = graded.false_positive ?? 0;
  const gradedTotal = tp + bp + fp;

  const tiles: { label: string; value: number; to: string }[] = [
    { label: "Open incidents", value: totals.open, to: "/queue" },
    { label: "High priority, open", value: totals.openHigh, to: "/queue?priority=high" },
    { label: "Unassigned", value: totals.unassigned, to: "/queue?assignee=unassigned" },
    { label: "In progress", value: totals.inProgress, to: "/queue?status=in_progress" },
    { label: "Assigned to me", value: totals.mine, to: "/queue?assignee=me" },
  ];

  return (
    <>
      <PageHeader title="Dashboard" subtitle="The state of the queue right now." />

      <div className="tiles">
        {tiles.map((tile) => (
          <Link key={tile.label} to={tile.to} className="tile">
            <span className="tile-label">{tile.label}</span>
            <span className="tile-value">{count(tile.value)}</span>
          </Link>
        ))}
      </div>

      <div className="grid-2">
        <section className="card" aria-labelledby="by-priority">
          <h2 id="by-priority">Open incidents by priority</h2>
          <ul className="bars">
            {BANDS.map((band) => (
              <li key={band}>
                <span className="bar-label">{BAND_LABEL[band]}</span>
                <span className="bar-track">
                  <span className={`bar-fill bar-${band}`} style={{ width: `${((priority[band] ?? 0) / maxPriority) * 100}%` }} />
                </span>
                <span className="num">{count(priority[band] ?? 0)}</span>
              </li>
            ))}
          </ul>
          <p className="muted small">
            High: at least 40% of the detector's past incidents were real threats. Low: under 15%.
          </p>
        </section>

        <section className="card" aria-labelledby="outcomes">
          <h2 id="outcomes">What closed incidents turned out to be</h2>
          {gradedTotal === 0 ? (
            <p className="muted">No incidents have been graded yet.</p>
          ) : (
            <>
              <OutcomeBar tp={tp} bp={bp} fp={fp} />
              <ul className="legend">
                {(
                  [
                    ["true_positive", tp],
                    ["benign_positive", bp],
                    ["false_positive", fp],
                  ] as const
                ).map(([g, n]) => (
                  <li key={g}>
                    <span className={`swatch seg-${g}`} aria-hidden="true" />
                    {GRADE_LABEL[g]}
                    <span className="num">
                      {percent(n / gradedTotal)} <span className="muted">({count(n)})</span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section className="card" aria-labelledby="by-category">
          <h2 id="by-category">Open incidents by category</h2>
          <ul className="bars">
            {byCategory.map((c) => (
              <li key={c.category}>
                <span className="bar-label">{categoryLabel(c.category)}</span>
                <span className="bar-track">
                  <span className="bar-fill" style={{ width: `${(c.open / maxCategory) * 100}%` }} />
                </span>
                <span className="num">{count(c.open)}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="card" aria-labelledby="workload">
          <h2 id="workload">Open incidents per analyst</h2>
          <ul className="bars">
            {workload.map((w) => (
              <li key={w.id}>
                <span className="bar-label">{w.name}</span>
                <span className="bar-track">
                  <span className="bar-fill" style={{ width: `${(w.open / maxWorkload) * 100}%` }} />
                </span>
                <span className="num">{count(w.open)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
