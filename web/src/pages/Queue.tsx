import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, type Band, type QueueFilters, type Status } from "../api";
import { ErrorState, Loading, PageHeader, Pagination, PriorityBadge, StatusBadge } from "../components/ui";
import { categoryLabel, dateTime } from "../format";

const STATUS_TABS: { value: Status | "open" | ""; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "new", label: "New" },
  { value: "in_progress", label: "In progress" },
  { value: "closed", label: "Closed" },
  { value: "", label: "All" },
];

/** Reads the queue filters from the URL, so a filtered view can be bookmarked or shared. */
export function filtersFromParams(params: URLSearchParams): QueueFilters {
  const status = params.get("status");
  return {
    // no status parameter means the default view: everything still open
    status: status === null ? "open" : status === "all" ? undefined : (status as Status),
    priority: (params.get("priority") as Band | null) ?? undefined,
    category: params.get("category") ?? undefined,
    assignee: params.get("assignee") ?? undefined,
    q: params.get("q") ?? undefined,
    sort: (params.get("sort") as QueueFilters["sort"] | null) ?? "priority",
    page: Number(params.get("page") ?? 1) || 1,
  };
}

export function QueuePage() {
  const [params, setParams] = useSearchParams();
  const filters = filtersFromParams(params);
  const [search, setSearch] = useState(filters.q ?? "");

  /** Updates one filter; any filter change goes back to page 1. */
  function setFilter(key: string, value: string | undefined) {
    const next = new URLSearchParams(params);
    if (value === undefined || value === "") next.delete(key);
    else next.set(key, value);
    if (key !== "page") next.delete("page");
    setParams(next, { replace: key === "q" });
  }

  // Debounce typing so each keystroke is not a request.
  useEffect(() => {
    const handle = setTimeout(() => {
      if ((filters.q ?? "") !== search.trim()) setFilter("q", search.trim() || undefined);
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const query = useQuery({
    queryKey: ["incidents", filters],
    queryFn: () => api.incidents(filters),
    placeholderData: keepPreviousData,
  });
  const categories = useQuery({ queryKey: ["categories"], queryFn: api.categories, staleTime: 300_000 });

  const activeStatus = filters.status ?? "";
  const hasFilters = !!(filters.priority || filters.category || filters.assignee || filters.q);

  return (
    <>
      <PageHeader
        title="Incident queue"
        subtitle="Ranked by priority: the share of each detector's past incidents that were real threats."
      />

      <div className="tabs" role="tablist" aria-label="Status">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.label}
            role="tab"
            aria-selected={activeStatus === tab.value}
            className={activeStatus === tab.value ? "tab active" : "tab"}
            onClick={() => setFilter("status", tab.value === "open" ? undefined : tab.value || "all")}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="filters">
        <div className="field field-grow">
          <label htmlFor="q">Search</label>
          <input
            id="q"
            type="search"
            placeholder="Reference or title"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="priority">Priority</label>
          <select id="priority" value={filters.priority ?? ""} onChange={(e) => setFilter("priority", e.target.value)}>
            <option value="">Any</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="category">Category</label>
          <select id="category" value={filters.category ?? ""} onChange={(e) => setFilter("category", e.target.value)}>
            <option value="">Any</option>
            {categories.data?.map((c) => (
              <option key={c} value={c}>
                {categoryLabel(c)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="assignee">Assignee</label>
          <select id="assignee" value={filters.assignee ?? ""} onChange={(e) => setFilter("assignee", e.target.value)}>
            <option value="">Anyone</option>
            <option value="me">Me</option>
            <option value="unassigned">Unassigned</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="sort">Sort by</label>
          <select id="sort" value={filters.sort} onChange={(e) => setFilter("sort", e.target.value === "priority" ? undefined : e.target.value)}>
            <option value="priority">Priority</option>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
        </div>
      </div>

      {query.isPending ? (
        <Loading label="Loading incidents" />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : query.data.items.length === 0 ? (
        <div className="state">
          <p>No incidents match these filters.</p>
          {hasFilters && (
            <button
              className="btn"
              onClick={() => {
                setSearch("");
                setParams(activeStatus === "open" ? {} : { status: activeStatus || "all" });
              }}
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <>
          <div className={query.isPlaceholderData ? "table-wrap is-stale" : "table-wrap"}>
            <table>
              <thead>
                <tr>
                  <th scope="col">Priority</th>
                  <th scope="col">Incident</th>
                  <th scope="col">Category</th>
                  <th scope="col" className="num">
                    Alerts
                  </th>
                  <th scope="col">First seen</th>
                  <th scope="col">Assignee</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {query.data.items.map((incident) => (
                  <tr key={incident.id}>
                    <td>
                      <PriorityBadge band={incident.priorityBand} score={incident.priorityScore} />
                    </td>
                    <td>
                      <Link className="row-link" to={`/incidents/${incident.id}`}>
                        {incident.title}
                      </Link>
                      <div className="mono muted">{incident.externalRef}</div>
                    </td>
                    <td>{categoryLabel(incident.category)}</td>
                    <td className="num">{incident.alertCount}</td>
                    <td className="nowrap">{dateTime(incident.firstSeenAt)}</td>
                    <td>{incident.assigneeName ?? <span className="muted">Unassigned</span>}</td>
                    <td>
                      <StatusBadge status={incident.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={query.data.page}
            pageSize={query.data.pageSize}
            total={query.data.total}
            onPage={(page) => setFilter("page", page === 1 ? undefined : String(page))}
          />
        </>
      )}
    </>
  );
}
