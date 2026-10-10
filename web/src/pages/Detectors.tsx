import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { ErrorState, Loading, OutcomeBar, PageHeader, ShareBar } from "../components/ui";
import { GRADE_LABEL, categoryLabel, count, hitRate, isNoisy } from "../format";

export function DetectorsPage() {
  const query = useQuery({ queryKey: ["detectors"], queryFn: api.detectors });
  if (query.isPending) return <Loading label="Loading detectors" />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const detectors = query.data;
  const total = detectors.reduce((sum, d) => sum + d.incidents, 0);
  const noisy = detectors.filter((d) => isNoisy(d.truePositives, d.graded));
  const noisyIncidents = noisy.reduce((sum, d) => sum + d.incidents, 0);

  return (
    <>
      <PageHeader
        title="Detectors"
        subtitle="How much work each detection rule creates, and how often it finds a real threat."
      />

      {noisy.length > 0 && (
        <div className="callout">
          <strong>
            {noisy.length} {noisy.length === 1 ? "detector almost never finds" : "detectors almost never find"} a real threat.
          </strong>{" "}
          They opened {count(noisyIncidents)} incidents ({total ? Math.round((noisyIncidents / total) * 100) : 0}% of
          the total) with a true-positive rate under 2%. They are candidates for tuning.
        </div>
      )}

      <ul className="legend legend-inline" aria-label="Outcome mix colours">
        {(["true_positive", "benign_positive", "false_positive"] as const).map((g) => (
          <li key={g}>
            <span className={`swatch seg-${g}`} aria-hidden="true" />
            {GRADE_LABEL[g]}
          </li>
        ))}
      </ul>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Detector</th>
              <th scope="col">Category</th>
              <th scope="col" className="num">
                Incidents
              </th>
              <th scope="col" className="num">
                Open
              </th>
              <th scope="col" className="num">
                Graded
              </th>
              <th scope="col">Real threats</th>
              <th scope="col">Outcome mix</th>
            </tr>
          </thead>
          <tbody>
            {detectors.map((d) => {
              const rate = hitRate(d.truePositives, d.graded);
              return (
                <tr key={d.id}>
                  <td>
                    <span className="mono">{d.name}</span>
                    {isNoisy(d.truePositives, d.graded) && <span className="tag tag-warn">Noisy</span>}
                  </td>
                  <td>{categoryLabel(d.category)}</td>
                  <td className="num">{count(d.incidents)}</td>
                  <td className="num">{count(d.open)}</td>
                  <td className="num">{count(d.graded)}</td>
                  <td>{rate === null ? <span className="muted">No history</span> : <ShareBar value={rate} />}</td>
                  <td>
                    <OutcomeBar tp={d.truePositives} bp={d.benignPositives} fp={d.falsePositives} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted small">Showing the {detectors.length} detectors with the most incidents.</p>
    </>
  );
}
