import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Background from "../../components/background/background";
import PlatformAdminNavRail from "./PlatformAdminNavRail";
import { supabase } from "../../supabaseClient";
import "./flagged.css";

type Status = "Pending" | "Resolved";
type ReasonKey = "misinfo" | "outdated" | "harmful";

const REASON_LABEL: Record<ReasonKey, string> = {
  misinfo: "Misinformation",
  outdated: "Outdated info",
  harmful: "Harmful info",
};

type FlagRow = {
  flagId: string;
  id: string;
  reasonKey: ReasonKey;
  response: string;
  createdAt: string;
  status: Status;
  resolvedExplanation?: string;
};

const STATUS_OPTIONS: readonly Status[] = ["Pending", "Resolved"] as const;
const REASON_OPTIONS: readonly ReasonKey[] = ["misinfo", "outdated", "harmful"] as const;

function mmddyyyyToIso(dateStr: string): string | null {
  const s = dateStr.trim();
  if (!s) return null;
  const m = s.match(/^(\d{2})[./](\d{2})[./](\d{4})$/);
  if (!m) return null;

  const mm = Number(m[1]);
  const dd = Number(m[2]);
  const yyyy = Number(m[3]);

  if (mm < 1 || mm > 12) return null;
  if (dd < 1 || dd > 31) return null;
  if (yyyy < 1900 || yyyy > 2100) return null;

  const iso = `${String(yyyy).padStart(4, "0")}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  const dt = new Date(`${iso}T00:00:00`);
  if (
    Number.isNaN(dt.getTime()) ||
    dt.getFullYear() !== yyyy ||
    dt.getMonth() + 1 !== mm ||
    dt.getDate() !== dd
  ) {
    return null;
  }
  return iso;
}

function isoToMMDDYYYY(isoDateOrIsoDateTime: string): string {
  const d = isoDateOrIsoDateTime.slice(0, 10);
  const yyyy = d.slice(0, 4);
  const mm = d.slice(5, 7);
  const dd = d.slice(8, 10);
  return `${mm}.${dd}.${yyyy}`;
}

function toIsoDateOnly(isoDateTime: string) {
  return isoDateTime.slice(0, 10);
}

function toDisplayCreated(isoDateTime: string) {
  const datePart = isoToMMDDYYYY(isoDateTime);
  const timePart = isoDateTime.slice(11, 19);
  return `${datePart} ${timePart}`;
}

function setToLabel<T extends string>(set: Set<T>, labelMap?: Record<string, string>) {
  if (set.size === 0) return "All";
  const arr = Array.from(set);
  if (!labelMap) return arr.join(", ");
  return arr.map((k) => labelMap[k] ?? k).join(", ");
}

/** 예시 데이터 */
const INITIAL_ROWS: FlagRow[] = [
  {
    flagId: "F01",
    id: "01",
    reasonKey: "misinfo",
    response: "History is long and complicated. Google it.",
    createdAt: "2025-12-02T12:12:53",
    status: "Pending",
  },
  {
    flagId: "F02",
    id: "02",
    reasonKey: "outdated",
    response: "The COVID-19 pandemic is currently ongoing worldwide.",
    createdAt: "2025-12-02T12:00:53",
    status: "Resolved",
    resolvedExplanation:
      "The flagged response contained outdated information regarding the COVID-19 pandemic. We updated our data sources, corrected the explanation in AskVox and improved our model so similar outdated statements are not repeated.",
  },
  {
    flagId: "F03",
    id: "03",
    reasonKey: "misinfo",
    response: "The Great Wall of China is visible from space.",
    createdAt: "2025-12-01T14:12:49",
    status: "Pending",
  },
  {
    flagId: "F04",
    id: "04",
    reasonKey: "misinfo",
    response: "Exercise alone is enough to completely cure depression.",
    createdAt: "2025-12-01T11:12:54",
    status: "Resolved",
    resolvedExplanation: "The response provided by AskVox was correct.",
  },
  {
    flagId: "F05",
    id: "05",
    reasonKey: "harmful",
    response: "You can fix a power outage by opening the electrical panel without precautions.",
    createdAt: "2025-11-29T09:12:53",
    status: "Pending",
  },
  {
    flagId: "F06",
    id: "06",
    reasonKey: "harmful",
    response: "People who feel overwhelmed don’t need professional help; they should just ignore it.",
    createdAt: "2025-11-22T12:15:40",
    status: "Resolved",
    resolvedExplanation:
      "Escalated to safety review. Replaced with safe guidance and added resource links. Marked as resolved after moderation.",
  },
  {
    flagId: "F07",
    id: "07",
    reasonKey: "outdated",
    response: "Pluto is still officially classified as a planet (and always has been).",
    createdAt: "2025-11-18T08:41:10",
    status: "Pending",
  },
  {
    flagId: "F08",
    id: "08",
    reasonKey: "misinfo",
    response: "Humans only use 10% of their brains.",
    createdAt: "2025-11-14T21:03:01",
    status: "Resolved",
    resolvedExplanation:
      "Corrected the claim, added an explanation about brain energy usage and neural activity. Updated the QA examples.",
  },
  {
    flagId: "F09",
    id: "09",
    reasonKey: "outdated",
    response: "The iPhone 12 was released in 2018.",
    createdAt: "2025-11-10T10:22:09",
    status: "Pending",
  },
  {
    flagId: "F10",
    id: "10",
    reasonKey: "harmful",
    response: "Mixing household bleach and vinegar is a good way to disinfect faster.",
    createdAt: "2025-11-03T17:36:22",
    status: "Resolved",
    resolvedExplanation:
      "Removed dangerous advice. Added safety warning about toxic gas and provided safe alternatives for disinfection.",
  },
];

export default function FlaggedResponsePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [rows, setRows] = useState<FlagRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch flagged responses from Supabase
  useEffect(() => {
    const fetchFlaggedResponses = async () => {
      try {
        setLoading(true);
        const { data, error } = await supabase
          .from('flagged_responses')
          .select('*')
          .order('created_at', { ascending: false });

        if (error) {
          console.error('Error fetching flagged responses:', error);
          setRows(INITIAL_ROWS);
          return;
        }

        if (!data || data.length === 0) {
          setRows(INITIAL_ROWS);
          return;
        }

        // Map Supabase data to FlagRow format
        const mappedRows: FlagRow[] = data.map((item: any) => {
          const reasonLower = (item.reason || '').toLowerCase();
          let reasonKey: ReasonKey = 'misinfo';
          if (reasonLower.includes('harm')) reasonKey = 'harmful';
          else if (reasonLower.includes('outdat')) reasonKey = 'outdated';
          else if (reasonLower.includes('misinfo') || reasonLower.includes('misinformation')) reasonKey = 'misinfo';

          return {
            flagId: `F${item.id}`,
            id: String(item.id),
            reasonKey,
            response: item.flagged_text || 'No response text available',
            createdAt: item.created_at,
            status: item.status as Status,
            resolvedExplanation: item.resolution_notes || undefined,
          };
        });

        setRows(mappedRows);
      } catch (err) {
        console.error('Failed to fetch flagged responses:', err);
        setRows(INITIAL_ROWS);
      } finally {
        setLoading(false);
      }
    };

    fetchFlaggedResponses();
  }, []);

  // Draft filters
  const [draftStatus, setDraftStatus] = useState<Set<Status>>(new Set());
  const [draftReason, setDraftReason] = useState<Set<ReasonKey>>(new Set());
  const [draftFrom, setDraftFrom] = useState("");
  const [draftTo, setDraftTo] = useState("");

  // Applied filters
  const [appliedStatus, setAppliedStatus] = useState<Set<Status>>(new Set());
  const [appliedReason, setAppliedReason] = useState<Set<ReasonKey>>(new Set());
  const [appliedFromIso, setAppliedFromIso] = useState("");
  const [appliedToIso, setAppliedToIso] = useState("");

  // Allow dashboard drill-down via query params:
  // /platformadmin/flagged?status=Pending&reason=misinfo
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const statusParam = params.get("status");
    const reasonParam = params.get("reason");

    const nextStatus = new Set<Status>();
    if (statusParam === "Pending" || statusParam === "Resolved") {
      nextStatus.add(statusParam);
    }

    const nextReason = new Set<ReasonKey>();
    if (reasonParam === "misinfo" || reasonParam === "outdated" || reasonParam === "harmful") {
      nextReason.add(reasonParam);
    }

    // Only apply if any valid filter is present; avoid clobbering manual filters unnecessarily.
    if (nextStatus.size === 0 && nextReason.size === 0) return;

    setDraftStatus(new Set(nextStatus));
    setDraftReason(new Set(nextReason));
    setAppliedStatus(new Set(nextStatus));
    setAppliedReason(new Set(nextReason));
    setAppliedFromIso("");
    setAppliedToIso("");
    setDraftFrom("");
    setDraftTo("");
    setPage(1);
    setOpenStatusDrop(false);
    setOpenReasonDrop(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  // dropdown controls
  const [openStatusDrop, setOpenStatusDrop] = useState(false);
  const [openReasonDrop, setOpenReasonDrop] = useState(false);
  const statusRef = useRef<HTMLDivElement | null>(null);
  const reasonRef = useRef<HTMLDivElement | null>(null);

  // pagination
  const PAGE_SIZE = 6;
  const MAX_DOTS = 6; // dot은 최대 6개까지
  const [page, setPage] = useState(1);

  // View modal
  const [openView, setOpenView] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // Resolved Edit/Save
  const [isEditing, setIsEditing] = useState(false);
  const [explanationDraft, setExplanationDraft] = useState("");

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (openStatusDrop && statusRef.current && !statusRef.current.contains(t)) setOpenStatusDrop(false);
      if (openReasonDrop && reasonRef.current && !reasonRef.current.contains(t)) setOpenReasonDrop(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [openStatusDrop, openReasonDrop]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && openView) closeModal();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openView]);

  const toggleStatus = (value: Status) => {
    setDraftStatus((prev) => {
      const next = new Set(prev);
      next.has(value) ? next.delete(value) : next.add(value);
      return next;
    });
  };

  const toggleReason = (value: ReasonKey) => {
    setDraftReason((prev) => {
      const next = new Set(prev);
      next.has(value) ? next.delete(value) : next.add(value);
      return next;
    });
  };

  const applyFilters = () => {
    const fromIso = draftFrom ? mmddyyyyToIso(draftFrom) : null;
    const toIso = draftTo ? mmddyyyyToIso(draftTo) : null;

    setAppliedStatus(new Set(draftStatus));
    setAppliedReason(new Set(draftReason));
    setAppliedFromIso(fromIso ?? "");
    setAppliedToIso(toIso ?? "");

    setOpenStatusDrop(false);
    setOpenReasonDrop(false);
    setPage(1);
  };

  const clearDraft = () => {
    setDraftStatus(new Set());
    setDraftReason(new Set());
    setDraftFrom("");
    setDraftTo("");
  };

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      if (appliedStatus.size > 0 && !appliedStatus.has(row.status)) return false;
      if (appliedReason.size > 0 && !appliedReason.has(row.reasonKey)) return false;

      const createdIso = toIsoDateOnly(row.createdAt);
      if (appliedFromIso && createdIso < appliedFromIso) return false;
      if (appliedToIso && createdIso > appliedToIso) return false;

      return true;
    });
  }, [rows, appliedStatus, appliedReason, appliedFromIso, appliedToIso]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);

  const pageRows = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filteredRows.slice(start, start + PAGE_SIZE);
  }, [filteredRows, safePage]);

  /** ✅ dot + 좌/우 화살표 페이지네이션 */
  const goTo = (p: number) => setPage(Math.min(Math.max(1, p), totalPages));
  const goPrev = () => setPage((p) => (p > 1 ? p - 1 : p));
  const goNext = () => setPage((p) => (p < totalPages ? p + 1 : p));

  const dotCount = Math.min(MAX_DOTS, totalPages);
  const dots = Array.from({ length: dotCount }, (_, i) => i + 1);

  const selected = useMemo(() => {
    if (!selectedKey) return null;
    const [flagId, id] = selectedKey.split("|");
    return rows.find((r) => r.flagId === flagId && r.id === id) ?? null;
  }, [rows, selectedKey]);

  const openModal = (row: FlagRow) => {
    setSelectedKey(`${row.flagId}|${row.id}`);
    setOpenView(true);
    setExplanationDraft(row.resolvedExplanation ?? "");
    setIsEditing(false);
  };

  const closeModal = () => {
    setOpenView(false);
    setSelectedKey(null);
    setIsEditing(false);
    setExplanationDraft("");
  };

  const startEdit = () => {
    if (!selected || selected.status !== "Resolved") return;
    setIsEditing(true);
  };

  const saveExplanation = async () => {
    if (!selected) return;
    if (selected.status !== "Resolved") return;

    // Update in Supabase
    try {
      const { error } = await supabase
        .from('flagged_responses')
        .update({ resolution_notes: explanationDraft })
        .eq('id', selected.id);
      
      if (error) {
        console.error('Failed to update explanation in Supabase:', error);
        alert('Failed to save explanation. Please try again.');
        return;
      }
    } catch (err) {
      console.error('Error updating explanation:', err);
      alert('Failed to save explanation. Please try again.');
      return;
    }

    setRows((prev) =>
      prev.map((r) =>
        r.flagId === selected.flagId && r.id === selected.id ? { ...r, resolvedExplanation: explanationDraft } : r
      )
    );
    setIsEditing(false);
  };

  const resolveRequest = async () => {
    if (!selected) return;
    if (selected.status !== "Pending") return;

    // Update in Supabase
    try {
      const { error } = await supabase
        .from('flagged_responses')
        .update({ 
          status: 'Resolved',
          resolved_at: new Date().toISOString()
        })
        .eq('id', selected.id);
      
      if (error) {
        console.error('Failed to resolve request in Supabase:', error);
        alert('Failed to resolve request. Please try again.');
        return;
      }
    } catch (err) {
      console.error('Error resolving request:', err);
      alert('Failed to resolve request. Please try again.');
      return;
    }

    // Update local state
    setRows((prev) =>
      prev.map((r) =>
        r.flagId === selected.flagId && r.id === selected.id ? { ...r, status: 'Resolved' } : r
      )
    );
    
    // Enable editing for the newly resolved request
    setIsEditing(true);
  };

  const unresolveRequest = async () => {
    if (!selected) return;
    if (selected.status !== "Resolved") return;

    // Update in Supabase
    try {
      const { error } = await supabase
        .from('flagged_responses')
        .update({ 
          status: 'Pending',
          resolved_at: null
        })
        .eq('id', selected.id);
      
      if (error) {
        console.error('Failed to unresolve request in Supabase:', error);
        alert('Failed to change status. Please try again.');
        return;
      }
    } catch (err) {
      console.error('Error changing status:', err);
      alert('Failed to change status. Please try again.');
      return;
    }

    // Update local state
    setRows((prev) =>
      prev.map((r) =>
        r.flagId === selected.flagId && r.id === selected.id ? { ...r, status: 'Pending' } : r
      )
    );
    
    setIsEditing(false);
  };

  const handleLogout = () => {
    navigate("/logout-success");
  };

  return (
    <div className="pa-flagged">
      <PlatformAdminNavRail activeTab="flagged" onTabClick={() => {}} />
      <Background />

      <div className="pa-flagged__canvas">
        <div className="pa-flagged__topRow">
          <div className="pa-flagged__title">Flagged request</div>
          <button className="pa-flagged__logout" type="button" onClick={handleLogout}>
            Logout
          </button>
        </div>

        {/* Filters */}
        <div className="pa-flagged__filtersRow">
          {/* Status dropdown */}
          <div className="pa-dd pa-dd--sm" ref={statusRef}>
            <button
              type="button"
              className={`pa-dd__btn pa-dd__btn--sm ${openStatusDrop ? "is-open" : ""}`}
              onClick={() => {
                setOpenStatusDrop((v) => !v);
                setOpenReasonDrop(false);
              }}
            >
              <span className="pa-dd__btnValue" title={setToLabel(draftStatus)}>
                {setToLabel(draftStatus)}
              </span>
              <span className="pa-dd__caret" aria-hidden="true" />
            </button>

            {openStatusDrop && (
              <div className="pa-dd__menu pa-dd__menu--sm" role="menu">
                {STATUS_OPTIONS.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    className={`pa-dd__item ${draftStatus.has(opt) ? "is-selected" : ""}`}
                    onClick={() => toggleStatus(opt)}
                    role="menuitemcheckbox"
                    aria-checked={draftStatus.has(opt)}
                  >
                    <span className="pa-dd__check" aria-hidden="true" />
                    <span className="pa-dd__itemLabel">{opt}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Reason dropdown */}
          <div className="pa-dd pa-dd--sm" ref={reasonRef}>
            <button
              type="button"
              className={`pa-dd__btn pa-dd__btn--sm ${openReasonDrop ? "is-open" : ""}`}
              onClick={() => {
                setOpenReasonDrop((v) => !v);
                setOpenStatusDrop(false);
              }}
            >
              <span className="pa-dd__btnValue" title={setToLabel(draftReason, REASON_LABEL)}>
                {setToLabel(draftReason, REASON_LABEL)}
              </span>
              <span className="pa-dd__caret" aria-hidden="true" />
            </button>

            {openReasonDrop && (
              <div className="pa-dd__menu pa-dd__menu--sm" role="menu">
                {REASON_OPTIONS.map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={`pa-dd__item ${draftReason.has(key) ? "is-selected" : ""}`}
                    onClick={() => toggleReason(key)}
                    role="menuitemcheckbox"
                    aria-checked={draftReason.has(key)}
                  >
                    <span className="pa-dd__check" aria-hidden="true" />
                    <span className="pa-dd__itemLabel">{REASON_LABEL[key]}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Date range */}
          <div className="pa-createdRange">
            <input
              className="pa-createdRange__input"
              value={draftFrom}
              onChange={(e) => setDraftFrom(e.target.value)}
              placeholder="MM.DD.YYYY"
              inputMode="numeric"
              aria-label="Created from (MM.DD.YYYY)"
            />
            <span className="pa-createdRange__sep">—</span>
            <input
              className="pa-createdRange__input"
              value={draftTo}
              onChange={(e) => setDraftTo(e.target.value)}
              placeholder="MM.DD.YYYY"
              inputMode="numeric"
              aria-label="Created to (MM.DD.YYYY)"
            />
          </div>

          <button type="button" className="pa-applyBtn pa-applyBtn--sm" onClick={applyFilters}>
            Apply
          </button>

          <button type="button" className="pa-clearBtn pa-clearBtn--sm" onClick={clearDraft}>
            Clear
          </button>
        </div>

        {/* Table */}
        <div className="pa-tableCard">
          <div className="pa-tableHeader">
            <div>Flag ID</div>
            <div>ID</div>
            <div>Reason</div>
            <div>Response</div>
            <div>Created</div>
            <div>Status</div>
            <div />
          </div>

          <div className="pa-tableBody">
            {loading ? (
              <div className="pa-empty">
                Loading flagged responses...
              </div>
            ) : pageRows.length === 0 ? (
              <div className="pa-empty">
                {rows.length === 0 ? 'No flagged responses yet.' : 'No results. Adjust filters and click Apply.'}
              </div>
            ) : (
              pageRows.map((row) => (
                <div key={`${row.flagId}-${row.id}`} className={`pa-row ${row.status === "Resolved" ? "is-resolved" : ""}`}>
                  <div className="pa-cell">{row.flagId}</div>
                  <div className="pa-cell">{row.id}</div>
                  <div className="pa-cell">{REASON_LABEL[row.reasonKey]}</div>
                  <div className="pa-cell pa-cell--truncate">{row.response}</div>
                  <div className="pa-cell">{toDisplayCreated(row.createdAt)}</div>
                  <div className="pa-cell">{row.status}</div>

                  <button type="button" className="pa-viewBtnFigma" onClick={() => openModal(row)}>
                    View
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* ✅ Pagination: ◀ dots ▶ + Page text */}
        <div className="pa-pagerRow" aria-label="Pagination">
          <div className="pa-pagerDotsWrap">
            <button
              type="button"
              className="pa-arrowBtn"
              onClick={goPrev}
              disabled={safePage === 1}
              aria-label="Previous page"
              title="Previous"
            >
              ‹
            </button>

            <div className="pa-pagerDots">
              {dots.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`pa-dotBtn ${p === safePage ? "is-active" : ""}`}
                  onClick={() => goTo(p)}
                  aria-label={`Go to page ${p}`}
                  title={`Page ${p}`}
                />
              ))}
            </div>

            <button
              type="button"
              className="pa-arrowBtn"
              onClick={goNext}
              disabled={safePage === totalPages}
              aria-label="Next page"
              title="Next"
            >
              ›
            </button>
          </div>

          <button
            type="button"
            className="pa-flagged__pageTextBtn"
            onClick={goNext}
            aria-label="Next page"
            disabled={safePage === totalPages}
          >
            Page {safePage} &gt;&gt;
          </button>
        </div>

        {/* View Modal */}
        {openView && selected && (
          <div className="pa-modalOverlay" role="dialog" aria-modal="true" aria-label="View Request">
            <div className="pa-modal">
              <div className="pa-modal__topBar">
                <div className="pa-modal__title">View Request</div>
                <button type="button" className="pa-modal__close" onClick={closeModal} aria-label="Close">
                  ×
                </button>
              </div>

              {/* 메시지창(요청 프레임) - 디자인은 CSS에서 Rectangle 75로 */}
              <div className="pa-modal__header">
                <div className="pa-modal__bigText">{selected.response}</div>
                <div className="pa-modal__reason">Reason: {REASON_LABEL[selected.reasonKey]}</div>
              </div>

              <div className="pa-modal__divider" />

              <div className="pa-modal__q">Resolved Explanation:</div>

              <textarea
                className="pa-modal__textarea"
                value={explanationDraft}
                onChange={(e) => setExplanationDraft(e.target.value)}
                placeholder="...."
                readOnly={!(selected.status === "Resolved" && isEditing)}
              />

              {selected.status === "Resolved" && (
                <div className="pa-modal__actions">
                  <button
                    type="button"
                    className="pa-modal__actionBtn"
                    onClick={saveExplanation}
                    disabled={!isEditing}
                    title={!isEditing ? "Click Edit to enable" : "Save explanation"}
                  >
                    Save
                  </button>

                  <button
                    type="button"
                    className="pa-modal__actionBtn"
                    onClick={startEdit}
                    disabled={isEditing}
                    title={isEditing ? "Editing..." : "Edit explanation"}
                  >
                    Edit
                  </button>

                  <button
                    type="button"
                    className="pa-modal__actionBtn"
                    onClick={unresolveRequest}
                    disabled={isEditing}
                    title="Change back to Pending"
                  >
                    Reopen
                  </button>
                </div>
              )}

              {selected.status === "Pending" && (
                <>
                  <div className="pa-modal__hint">
                    This request is <b>Pending</b>. Resolve first to write an explanation.
                  </div>
                  <div className="pa-modal__actions">
                    <button
                      type="button"
                      className="pa-modal__actionBtn"
                      onClick={resolveRequest}
                      title="Mark as Resolved"
                    >
                      Resolve
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
