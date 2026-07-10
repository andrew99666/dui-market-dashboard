import { Fragment, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react';

import logo from './assets/tcb-rectangle.png';
import metrics from './data/cityMetrics.json';
import metadata from './data/datasetMetadata.json';
import places from './data/usPlaces.json';
import { MapPlaceholder } from './components/MapPlaceholder';
import {
  classifyCity,
  createSearchSuggestions,
  getKnownCpcMedian,
  getSelectedCityComparison,
  getStatusCounts,
  getTablePage,
  type CityStatus,
  type SearchSuggestion,
  type SortColumn,
} from './dashboard-domain';
import type { CityMetric } from './data/types';

type Tab = 'table' | 'map';
type Selection = SearchSuggestion | { source: 'researched'; metric: CityMetric; city: string; state: string; stateCode: string; placeId: string; latitude: number; longitude: number };

const researchedMetrics = metrics as CityMetric[];
const statusLabels: Record<CityStatus, string> = {
  qualified: 'Qualified',
  'high-cpc': 'High CPC',
  'unknown-cpc': 'Unknown CPC',
  'low-volume': 'Low volume',
  'no-data': 'No data',
};
const summaryStatuses: Exclude<CityStatus, 'no-data'>[] = ['qualified', 'high-cpc', 'unknown-cpc', 'low-volume'];
const states = [...new Map(researchedMetrics.map((metric) => [metric.stateCode, metric.state])).entries()]
  .sort((left, right) => left[1].localeCompare(right[1]));

const formatDate = (date: string) => new Intl.DateTimeFormat('en-US', {
  month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
}).format(new Date(`${date}T00:00:00Z`));

const formatCpc = (value: number | null) => value === null ? 'Unknown' : `$${value.toFixed(2)}`;

export default function App() {
  const [tab, setTab] = useState<Tab>('table');
  const [query, setQuery] = useState('');
  const [state, setState] = useState('all');
  const [status, setStatus] = useState<CityStatus | 'all'>('all');
  const [sort, setSort] = useState<{ column: SortColumn; direction: 'asc' | 'desc' }>({ column: 'totalSearchVolume', direction: 'desc' });
  const [page, setPage] = useState(1);
  const [selection, setSelection] = useState<Selection>();
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState<number | null>(null);
  const suggestions = useMemo(() => createSearchSuggestions(query, researchedMetrics, places), [query]);
  const table = useMemo(() => getTablePage(researchedMetrics, metadata, { query, state, status, sort, page }), [query, state, status, sort, page]);
  const counts = useMemo(() => getStatusCounts(researchedMetrics, metadata), []);
  const median = useMemo(() => getKnownCpcMedian(researchedMetrics), []);

  const resetPage = () => setPage(1);
  const updateQuery = (value: string) => { setQuery(value); setActiveSuggestionIndex(null); resetPage(); };
  const selectPlace = (suggestion: SearchSuggestion) => {
    setSelection(suggestion);
    setQuery(suggestion.city);
    setActiveSuggestionIndex(null);
    resetPage();
  };
  const clear = () => {
    setQuery('');
    setSelection(undefined);
    setActiveSuggestionIndex(null);
    setState('all');
    setStatus('all');
    resetPage();
  };
  const toggleSort = (column: SortColumn) => {
    setSort((current) => ({ column, direction: current.column === column && current.direction === 'desc' ? 'asc' : 'desc' }));
    resetPage();
  };
  const selectedMetric = selection?.source === 'researched' ? selection.metric : undefined;
  const selectedStatus = classifyCity(selectedMetric, metadata);
  const comparison = getSelectedCityComparison(selectedMetric, researchedMetrics);

  return (
    <main className="app-shell">
      <header className="app-header">
        <img className="brand-logo" src={logo} alt="The Call Blueprint" />
        <div className="header-copy">
          <h1>DUI Market Opportunity Dashboard</h1>
          <p>Data refreshed {formatDate(metadata.refreshedAt)}</p>
        </div>
      </header>

      <div className="dashboard-content">
        <div className="tabs" role="tablist" aria-label="Dashboard views">
          <button id="city-table-tab" type="button" role="tab" aria-selected={tab === 'table'} aria-controls="city-table-panel" onClick={() => setTab('table')}>City Table</button>
          <button id="map-tab" type="button" role="tab" aria-selected={tab === 'map'} aria-controls="map-panel" onClick={() => setTab('map')}>U.S. Map</button>
        </div>

        <section className="search-panel" aria-label="City search and filters">
          <label className="search-control">
            <Search size={18} aria-hidden="true" />
            <span className="sr-only">Search cities</span>
            <input aria-label="Search cities" role="combobox" aria-autocomplete="list" aria-expanded={suggestions.length > 0} aria-controls="city-suggestions" aria-activedescendant={activeSuggestionIndex === null ? undefined : `city-suggestion-${suggestions[activeSuggestionIndex].source}-${suggestions[activeSuggestionIndex].placeId}`} value={query} onChange={(event) => updateQuery(event.target.value)} onKeyDown={(event) => {
              if (event.key === 'Escape') {
                clear();
              } else if (event.key === 'ArrowDown' && suggestions.length) {
                event.preventDefault();
                setActiveSuggestionIndex((current) => current === null ? 0 : (current + 1) % suggestions.length);
              } else if (event.key === 'ArrowUp' && suggestions.length) {
                event.preventDefault();
                setActiveSuggestionIndex((current) => current === null ? suggestions.length - 1 : (current - 1 + suggestions.length) % suggestions.length);
              } else if (event.key === 'Enter' && activeSuggestionIndex !== null) {
                event.preventDefault();
                selectPlace(suggestions[activeSuggestionIndex]);
              }
            }} placeholder="Search city or state" />
            {query && <button type="button" className="icon-button" aria-label="Clear search" onClick={clear}><X size={16} /></button>}
          </label>
          {suggestions.length > 0 && (
            <ul id="city-suggestions" className="suggestions" role="listbox" aria-label="City suggestions">
              {suggestions.map((suggestion, index) => <Fragment key={`${suggestion.source}-${suggestion.placeId}`}>
                {(index === 0 || suggestions[index - 1].source !== suggestion.source) && <li className="suggestion-group" role="presentation">{suggestion.source === 'researched' ? 'Researched cities' : 'Other Census places'}</li>}
                <li id={`city-suggestion-${suggestion.source}-${suggestion.placeId}`} role="option" tabIndex={0} aria-selected={activeSuggestionIndex === index} onClick={() => selectPlace(suggestion)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectPlace(suggestion); } }}>
                  {suggestion.city}, {suggestion.state}
                </li>
              </Fragment>)}
            </ul>
          )}
          <label className="select-control">State
            <select value={state} onChange={(event) => { setState(event.target.value); resetPage(); }}>
              <option value="all">All states</option>
              {states.map(([code, name]) => <option value={code} key={code}>{name}</option>)}
            </select>
          </label>
        </section>

        {selection && (
          <section className="spotlight" aria-label="Selected city spotlight">
            <div>
              <p className="eyebrow">Selected city</p>
              <h2>{selection.city}, {selection.state}</h2>
              {selectedMetric ? <p className="status-line"><span className={`status-badge status-${selectedStatus}`}>{statusLabels[selectedStatus]}</span> Volume {selectedMetric.totalSearchVolume.toLocaleString()} - CPC {formatCpc(selectedMetric.averageCpcUsd)}</p> : <p className="no-data-copy"><span className="status-badge status-no-data">No data</span> No metrics in current dataset</p>}
            </div>
            {selectedMetric && <div className="spotlight-detail"><p>Known-CPC median <strong>${median.toFixed(2)}</strong></p><p>{comparison === null ? 'CPC comparison is unavailable because this city has no known CPC.' : `${comparison}% of other known-CPC cities have a higher CPC.`}</p></div>}
            <p className="methodology">Qualification is based only on configured search-volume/CPC thresholds.</p>
          </section>
        )}

        {tab === 'table' ? (
          <section id="city-table-panel" role="tabpanel" aria-labelledby="city-table-tab">
            <div className="summary-strip" aria-label="Status summary">
              {summaryStatuses.map((item) => <button type="button" key={item} className={`summary-item status-${item}`} onClick={() => { setStatus(item); resetPage(); }}><span>{statusLabels[item]}</span><strong>{counts[item]}</strong></button>)}
            </div>
            <div className="filter-bar" aria-label="Table filters">
              <div className="segmented-filter" role="group" aria-label="Status filter">
                {(['all', ...summaryStatuses] as const).map((item) => <button type="button" key={item} className={status === item ? 'active' : ''} aria-pressed={status === item} onClick={() => { setStatus(item); resetPage(); }}>{item === 'all' ? 'All' : statusLabels[item]}</button>)}
              </div>
              <p>Showing {table.total === 0 ? 0 : ((table.page - 1) * 25) + 1}-{Math.min(table.page * 25, table.total)} of {table.total}</p>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><SortableHeader label="City" column="city" sort={sort} onSort={toggleSort} /><SortableHeader label="State" column="state" sort={sort} onSort={toggleSort} /><SortableHeader label="Total Search Volume" column="totalSearchVolume" sort={sort} onSort={toggleSort} /><SortableHeader label="Average CPC" column="averageCpcUsd" sort={sort} onSort={toggleSort} /><th>Status</th></tr></thead>
                <tbody>{table.rows.map((metric) => <tr key={metric.placeId} className={`status-${classifyCity(metric, metadata)}`} onClick={() => selectPlace({ ...metric, source: 'researched', metric })} tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectPlace({ ...metric, source: 'researched', metric }); } }}><td>{metric.city}</td><td>{metric.state}</td><td>{metric.totalSearchVolume.toLocaleString()}</td><td>{formatCpc(metric.averageCpcUsd)}</td><td><span className={`status-badge status-${classifyCity(metric, metadata)}`}>{statusLabels[classifyCity(metric, metadata)]}</span></td></tr>)}</tbody>
              </table>
            </div>
            <ul className="mobile-results" aria-label="City results">{table.rows.map((metric) => <li key={metric.placeId} className={`status-${classifyCity(metric, metadata)}`}><button type="button" onClick={() => selectPlace({ ...metric, source: 'researched', metric })}><strong>{metric.city}, {metric.state}</strong><span>{metric.totalSearchVolume.toLocaleString()} searches - {formatCpc(metric.averageCpcUsd)}</span><span className={`status-badge status-${classifyCity(metric, metadata)}`}>{statusLabels[classifyCity(metric, metadata)]}</span></button></li>)}</ul>
            <nav className="pagination" aria-label="Table pagination"><button type="button" className="icon-button" aria-label="Previous page" disabled={table.page === 1} onClick={() => setPage((current) => current - 1)}><ChevronLeft size={18} /></button><span>Page {table.page} of {table.pageCount}</span><button type="button" className="icon-button" aria-label="Next page" disabled={table.page === table.pageCount} onClick={() => setPage((current) => current + 1)}><ChevronRight size={18} /></button></nav>
          </section>
        ) : <section id="map-panel" role="tabpanel" aria-labelledby="map-tab"><MapPlaceholder /></section>}
      </div>
    </main>
  );
}

function SortableHeader({ label, column, sort, onSort }: { label: string; column: SortColumn; sort: { column: SortColumn; direction: string }; onSort: (column: SortColumn) => void }) {
  const direction = sort.column === column ? sort.direction : undefined;
  return <th aria-sort={direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none'}><button type="button" onClick={() => onSort(column)}>{label}{direction ? ` (${direction})` : ''}</button></th>;
}
