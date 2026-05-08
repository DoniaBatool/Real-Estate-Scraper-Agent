import axios from "axios";
import type {
  Agency,
  Property,
  ScrapeJob,
  PricingData,
  AgencyFilters,
  PropertyFilters,
} from "@/types";

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000",
  headers: { "Content-Type": "application/json" },
});

export async function scrapeCity(city: string, country: string): Promise<ScrapeJob> {
  const { data } = await api.post<ScrapeJob>("/api/scrape", { city, country });
  return data;
}

export async function getJobStatus(jobId: string): Promise<ScrapeJob> {
  const { data } = await api.get<ScrapeJob>(`/api/scrape/${jobId}`);
  return data;
}

export async function getAgencies(filters: AgencyFilters = {}): Promise<Agency[]> {
  const { data } = await api.get<Agency[]>("/api/agencies", { params: filters });
  return data;
}

export async function getAgency(id: string): Promise<Agency> {
  const { data } = await api.get<Agency>(`/api/agencies/${id}`);
  return data;
}

export async function getProperties(filters: PropertyFilters = {}): Promise<Property[]> {
  const { data } = await api.get<Property[]>("/api/properties", { params: filters });
  return data;
}

export async function getPricingData(city?: string, country?: string): Promise<PricingData> {
  const { data } = await api.get<PricingData>("/api/pricing", { params: { city, country } });
  return data;
}
