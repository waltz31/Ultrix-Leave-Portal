import { useEffect, useMemo, useRef, useState } from 'react';
import { format, isSameDay, isWeekend } from 'date-fns';
import { avatarSrc } from '../utils';

const PAGE_SIZES = [7, 10, 25, 50];

const LEGEND = [
  { code: 'P', label: 'Present', kind: 'present' },
  { code: 'A', label: 'Absent', kind: 'absent' },
  { code: 'L', label: 'Late', kind: 'late' },
  { code: 'CL', label: 'Casual Leave', kind: 'leave-casual' },
  { code: 'PL', label: 'Privileged Leave', kind: 'leave-earned' },
  { code: 'SL', label: 'Sick Leave', kind: 'leave-sick' },
  { code: 'RL', label: 'Restricted Leave', kind: 'leave-restricted' },
  { code: 'WFH', label: 'Work from Home', kind: 'leave-wfh' },
  { code: 'WO', label: 'Weekly Off', kind: 'weekoff' },
  { code: 'HOL', label: 'Holiday', kind: 'holiday' },
  { code: 'HD', label: 'Half Day', kind: 'halfday' },
];

function visiblePages(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = [];
  const add = (value) => {
    if (pages[pages.length - 1] !== value) pages.push(value);
  };
  add(1);
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) add('…');
  for (let n = start; n <= end; n += 1) add(n);
  if (end < total - 1) add('…');
  add(total);
  return pages;
}

function employeeSubtitle(employee) {
  return [employee.employeeNumber, employee.department || employee.designation]
    .filter(Boolean)
    .join(' • ');
}

function cellHint(cell, employee, day) {
  const date = format(day, 'd MMM');
  const name = employee.name || 'Employee';
  if (cell?.label) return `${name} · ${date} · ${cell.label}`;
  if (!cell?.kind || cell.kind === 'empty' || cell.kind === 'loading') {
    return `${name}, ${date}`;
  }
  return `${name}, ${date}: ${cell.code}`;
}

function StatusMark({ cell }) {
  if (!cell || cell.kind === 'empty') return <span className="roster-empty">—</span>;
  if (cell.kind === 'loading') return <span className="roster-empty">…</span>;
  if (cell.kind === 'weekoff') return <span className="roster-wo">WO</span>;

  const shape = ['present', 'absent', 'late'].includes(cell.kind) ? 'circle' : 'square';
  return (
    <span className={`roster-mark is-${cell.kind} is-${shape}${cell.pending ? ' is-pending' : ''}`}>
      {cell.code}
      {cell.halfDay ? <i className="roster-hd-dot" title="Half day" /> : null}
    </span>
  );
}

export default function TeamRosterCalendar({
  cursor,
  onPrev,
  onNext,
  onToday,
  days,
  employees = [],
  getCell,
  onCellClick,
  canCreate = false,
  onAddLeave = null,
  today,
  loading = false,
}) {
  const scrollRef = useRef(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = (employees || []).filter((employee) => employee?.active !== false);
    if (!q) return list;
    return list.filter((employee) => {
      const hay = [employee.name, employee.employeeNumber, employee.department, employee.designation]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [employees, search]);

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);

  useEffect(() => {
    setPage(1);
  }, [search, pageSize, cursor]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const pageEmployees = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const pages = visiblePages(page, totalPages);

  function syncScrollButtons() {
    const node = scrollRef.current;
    if (!node) return;
    const max = node.scrollWidth - node.clientWidth;
    setCanScrollLeft(node.scrollLeft > 8);
    setCanScrollRight(max - node.scrollLeft > 8);
  }

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return undefined;
    const todayCol = node.querySelector('.roster-date.is-today');
    if (todayCol) {
      todayCol.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'instant' });
    } else {
      node.scrollLeft = 0;
    }
    syncScrollButtons();
    const onScroll = () => syncScrollButtons();
    node.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', syncScrollButtons);
    return () => {
      node.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', syncScrollButtons);
    };
  }, [days, pageEmployees.length, cursor]);

  function scrollDates(dir) {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollBy({ left: dir * Math.max(240, node.clientWidth * 0.45), behavior: 'smooth' });
  }

  const dayCount = days?.length || 0;

  return (
    <div className="roster">
      <div className="roster-toolbar">
        <div className="roster-nav">
          <button type="button" className="roster-nav-btn" onClick={onPrev} aria-label="Previous month">
            ‹
          </button>
          <h3>{format(cursor, 'MMMM yyyy')}</h3>
          <button type="button" className="roster-nav-btn" onClick={onNext} aria-label="Next month">
            ›
          </button>
          <button type="button" className="roster-today" onClick={onToday}>
            Today
          </button>
        </div>

        <label className="roster-search">
          <span className="sr-only">Search employees</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search employee"
          />
        </label>

        {canCreate && typeof onAddLeave === 'function' && (
          <button type="button" className="btn primary roster-add" onClick={onAddLeave}>
            Add leave
          </button>
        )}
      </div>

      <div className="roster-board">
        <div className="roster-scroll-wrap">
          {canScrollLeft && (
            <button
              type="button"
              className="roster-shift is-left"
              onClick={() => scrollDates(-1)}
              aria-label="Scroll dates left"
            >
              ‹
            </button>
          )}
          <div className="roster-scroll" ref={scrollRef}>
            <div className="roster-grid" style={{ '--roster-days': String(dayCount) }}>
              <div className="roster-head">
                <div className="roster-emp roster-emp-head">Employee</div>
                {(days || []).map((day) => (
                  <div
                    key={format(day, 'yyyy-MM-dd')}
                    className={[
                      'roster-date',
                      isWeekend(day) ? 'is-weekend' : '',
                      today && isSameDay(day, today) ? 'is-today' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <span className="roster-dow">{format(day, 'EEE')}</span>
                    <span className="roster-dayn">{format(day, 'd')}</span>
                  </div>
                ))}
              </div>

              {loading && !pageEmployees.length ? (
                <div className="roster-empty-row">Loading team…</div>
              ) : null}

              {!loading && !pageEmployees.length ? (
                <div className="roster-empty-row">
                  {search ? 'No employees match that search.' : 'No employees to show.'}
                </div>
              ) : null}

              {pageEmployees.map((employee) => (
                <div key={employee.id} className="roster-row">
                  <div className="roster-emp">
                    <img src={avatarSrc(employee.profilePhoto)} alt="" />
                    <div className="roster-emp-copy">
                      <strong>{employee.name}</strong>
                      <span>{employeeSubtitle(employee) || '—'}</span>
                    </div>
                  </div>
                  {(days || []).map((day) => {
                    const cell = getCell(employee, day) || { kind: 'empty' };
                    const interactive = typeof onCellClick === 'function';
                    const Tag = interactive ? 'button' : 'div';
                    const hint = cellHint(cell, employee, day);
                    return (
                      <Tag
                        key={`${employee.id}-${format(day, 'yyyy-MM-dd')}`}
                        type={interactive ? 'button' : undefined}
                        className={[
                          'roster-cell',
                          `is-${cell.kind || 'empty'}`,
                          isWeekend(day) ? 'is-weekend' : '',
                          today && isSameDay(day, today) ? 'is-today' : '',
                          cell.halfDay ? 'is-half' : '',
                          cell.label ? 'has-tip' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        aria-label={hint}
                        title={cell.label || hint}
                        onClick={interactive ? () => onCellClick(employee, day, cell) : undefined}
                      >
                        <StatusMark cell={cell} />
                        {cell.time ? <span className="roster-time">{cell.time}</span> : null}
                        {cell.label ? <span className="roster-tip">{cell.label}</span> : null}
                      </Tag>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
          {canScrollRight && (
            <button
              type="button"
              className="roster-shift is-right"
              onClick={() => scrollDates(1)}
              aria-label="Scroll dates right"
            >
              ›
            </button>
          )}
        </div>

        <div className="roster-pager">
          <p className="roster-range">
            {total === 0 ? 'No employees' : `${from}–${to} of ${total}`}
          </p>
          <div className="roster-pages">
            <button
              type="button"
              className="roster-page-btn"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              aria-label="Previous page"
            >
              ‹
            </button>
            {pages.map((item, index) =>
              item === '…' ? (
                <span key={`gap-${index}`} className="roster-ellipsis">
                  …
                </span>
              ) : (
                <button
                  key={item}
                  type="button"
                  className={`roster-page-btn${item === page ? ' is-active' : ''}`}
                  onClick={() => setPage(item)}
                >
                  {item}
                </button>
              )
            )}
            <button
              type="button"
              className="roster-page-btn"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              aria-label="Next page"
            >
              ›
            </button>
          </div>
          <label className="roster-size">
            Rows
            <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="roster-legend" aria-label="Attendance legend">
        {LEGEND.map((item) => (
          <span key={item.code} className="roster-legend-item" title={item.label}>
            {item.kind === 'halfday' ? (
              <i className="roster-hd-dot" />
            ) : item.kind === 'weekoff' ? (
              <span className="roster-wo">WO</span>
            ) : (
              <span
                className={`roster-mark is-${item.kind} is-${
                  ['present', 'absent', 'late'].includes(item.kind) ? 'circle' : 'square'
                }`}
              >
                {item.code}
              </span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}
