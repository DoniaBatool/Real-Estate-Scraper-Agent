"use client";

import axios from "axios";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { workbenchDiscover, type WorkbenchAgency } from "@/lib/api";

export type MaltaAgenciesPanelProps = {
  /** Called when the user checks/unchecks agencies (also cleared when a new discovery runs). */
  onSelectionChange?: (selected: WorkbenchAgency[]) => void;
};

function formatErr(e: unknown): string {
  if (axios.isAxiosError(e)) {
    if (e.code === "ECONNABORTED" || e.message?.toLowerCase().includes("timeout")) {
      return "Request timed out. Apify runs can take several minutes — try again, or check backend logs and APIFY_API_TOKEN.";
    }
    if (e.response?.data != null) {
      const d = e.response.data as { detail?: unknown };
      if (typeof d.detail === "string") return d.detail;
      if (Array.isArray(d.detail)) return JSON.stringify(d.detail);
    }
  }
  if (e instanceof Error) return e.message;
  return String(e);
}

/**
 * Country fixed to Malta; city drives Apify Google Places search for real estate agencies.
 */
export function MaltaAgenciesPanel({ onSelectionChange }: MaltaAgenciesPanelProps) {
  const [city, setCity] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [agencies, setAgencies] = useState<WorkbenchAgency[]>([]);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());

  useEffect(() => {
    const selected = agencies.filter((_, idx) => selectedIndices.has(idx));
    onSelectionChange?.(selected);
  }, [agencies, selectedIndices, onSelectionChange]);

  const runDiscover = async () => {
    const c = city.trim();
    if (!c) return;
    setLoading(true);
    setError("");
    try {
      const list = await workbenchDiscover(c);
      setAgencies(list);
      setSelectedIndices(new Set());
      if (!list.length) {
        setError(
          "No agencies with a website were returned. Ensure APIFY_API_TOKEN is set on the API server, or try another locality.",
        );
      }
    } catch (e: unknown) {
      setAgencies([]);
      setSelectedIndices(new Set());
      setError(formatErr(e));
    } finally {
      setLoading(false);
    }
  };

  const toggleRow = (index: number) => {
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  return (
    <section className="mb-8 rounded-xl border border-white/10 bg-[var(--bg-card)] p-5 md:p-6">
      <h2 className="mb-1 text-lg font-semibold text-white">Real estate agencies (Malta)</h2>
      <p className="mb-4 text-sm text-[var(--text-secondary)]">
        Country is <strong className="text-slate-200">Malta</strong>. Enter a town or locality, then run Apify discovery
        to list agencies with website links.
      </p>
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Country</span>
          <span className="inline-flex w-fit items-center rounded-lg border border-white/10 bg-[var(--bg-base)] px-3 py-2 text-sm font-medium text-slate-200">
            Malta
          </span>
        </div>
        <div className="min-w-[200px] flex-1 flex-col gap-1 sm:flex">
          <label htmlFor="malta-agency-city" className="text-xs font-medium uppercase tracking-wide text-gray-500">
            City / locality
          </label>
          <input
            id="malta-agency-city"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void runDiscover()}
            placeholder="e.g. St Julian's, Sliema, Valletta"
            className="theme-text-input w-full rounded-lg border border-white/10 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>
        <button
          type="button"
          onClick={() => void runDiscover()}
          disabled={loading || !city.trim()}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Finding agencies…
            </>
          ) : (
            <>Find agencies</>
          )}
        </button>
      </div>
      {error && <p className="mt-3 text-sm text-amber-400">{error}</p>}

      {agencies.length > 0 && (
        <div className="mt-6 overflow-x-auto rounded-lg border border-white/10">
          <table className="w-full min-w-[640px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-[var(--bg-base)] text-xs uppercase tracking-wide text-gray-500">
                <th className="w-10 px-2 py-2.5 font-medium" scope="col">
                  <span className="sr-only">Select</span>
                </th>
                <th className="px-3 py-2.5 font-medium">Agency</th>
                <th className="px-3 py-2.5 font-medium">Website</th>
                <th className="px-3 py-2.5 font-medium">Address</th>
                <th className="px-3 py-2.5 font-medium whitespace-nowrap">Rating</th>
              </tr>
            </thead>
            <tbody>
              {agencies.map((a, i) => {
                const url = (a.website_url || "").trim();
                const checked = selectedIndices.has(i);
                return (
                  <tr key={`${url}-${i}`} className="border-b border-white/5 hover:bg-white/[0.03]">
                    <td className="w-10 px-2 py-2.5 align-middle">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleRow(i)}
                        className="h-4 w-4 rounded border-white/20 bg-[var(--bg-base)] text-blue-600 focus:ring-blue-500"
                        aria-label={`Select ${a.name || "agency"}`}
                      />
                    </td>
                    <td className="max-w-[220px] px-3 py-2.5 align-top font-medium text-slate-200">
                      {a.name || "—"}
                    </td>
                    <td className="max-w-[min(360px,40vw)] px-3 py-2.5 align-top">
                      {url ? (
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="break-all text-blue-400 underline hover:text-blue-300"
                        >
                          {url}
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="max-w-[280px] px-3 py-2.5 align-top text-xs text-slate-400">
                      {a.address || "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 align-top text-xs text-slate-400">
                      {a.google_rating != null ? (
                        <>
                          ★ {Number(a.google_rating).toFixed(1)}
                          {a.review_count != null ? (
                            <span className="text-slate-500"> ({a.review_count})</span>
                          ) : null}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="border-t border-white/10 bg-[var(--bg-base)] px-3 py-2 text-xs text-gray-500">
            {agencies.length} agenc{agencies.length === 1 ? "y" : "ies"} with a website (Apify / Google Places).
          </p>
        </div>
      )}
    </section>
  );
}
