import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { ErrorState, Loading, PageHeader, Pagination } from "../components/ui";
import { dateTime } from "../format";
import { describeEvent } from "./Incident";

export function AuditPage() {
  const [page, setPage] = useState(1);
  const query = useQuery({ queryKey: ["audit", page], queryFn: () => api.audit(page), placeholderData: keepPreviousData });

  if (query.isPending) return <Loading label="Loading audit log" />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  return (
    <>
      <PageHeader title="Audit log" subtitle="Every change to an incident, newest first. Entries cannot be edited." />
      <div className={query.isPlaceholderData ? "table-wrap is-stale" : "table-wrap"}>
        <table>
          <thead>
            <tr>
              <th scope="col">Time</th>
              <th scope="col">Who</th>
              <th scope="col">Incident</th>
              <th scope="col">What happened</th>
            </tr>
          </thead>
          <tbody>
            {query.data.items.map((entry) => (
              <tr key={entry.id}>
                <td className="nowrap">{dateTime(entry.createdAt)}</td>
                <td>{entry.actorName ?? "System"}</td>
                <td>
                  <Link className="mono" to={`/incidents/${entry.incidentId}`}>
                    {entry.externalRef}
                  </Link>
                </td>
                <td>{entry.type === "comment" ? <>Note: {describeEvent(entry)}</> : describeEvent(entry)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={query.data.page} pageSize={query.data.pageSize} total={query.data.total} onPage={setPage} />
    </>
  );
}
