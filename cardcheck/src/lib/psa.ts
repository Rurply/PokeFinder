// Optional PSA cert verification via the PSA Public API (requires the user's own free token;
// free accounts get 100 calls/day). Only cert details are read; PSA offers no free graded
// price data, so none is shown.
import { type Cache, TTL } from './cache';
import { fetchJson, HttpError, type FetchLike } from './http';

export const PSA_API_BASE = 'https://api.psacard.com/publicapi';

export interface PsaCert {
  certNumber: string;
  year?: string;
  brand?: string;
  subject?: string;
  cardNumber?: string;
  variety?: string;
  grade?: string;
}

export type PsaResult =
  | { status: 'verified'; cert: PsaCert }
  | { status: 'not-found' | 'no-token' | 'error'; message: string };

interface PsaResponse {
  PSACert?: {
    CertNumber?: string;
    Year?: string;
    Brand?: string;
    Subject?: string;
    CardNumber?: string;
    Variety?: string;
    CardGrade?: string;
    GradeDescription?: string;
  };
  IsValidRequest?: boolean;
  ServerMessage?: string;
}

export async function verifyCert(
  cert: string,
  o: { token?: string; cache: Cache; fetchFn?: FetchLike },
): Promise<PsaResult> {
  if (!o.token) return { status: 'no-token', message: 'Add a free PSA API token in Settings to verify certs' };
  if (!/^\d{7,10}$/.test(cert)) return { status: 'error', message: 'Invalid cert number' };
  const cached = await o.cache.get<PsaResult>(`psa:${cert}`, TTL.psa);
  if (cached) return cached;
  try {
    const res = await fetchJson<PsaResponse>(
      `${PSA_API_BASE}/cert/GetByCertNumber/${cert}`,
      { headers: { Authorization: `bearer ${o.token}` } },
      o.fetchFn,
      { retries: 1 },
    );
    const c = res.PSACert;
    const result: PsaResult = c?.CertNumber
      ? {
          status: 'verified',
          cert: {
            certNumber: c.CertNumber,
            year: c.Year,
            brand: c.Brand,
            subject: c.Subject,
            cardNumber: c.CardNumber,
            variety: c.Variety,
            grade: c.CardGrade || c.GradeDescription,
          },
        }
      : { status: 'not-found', message: res.ServerMessage || 'Cert not found' };
    await o.cache.set(`psa:${cert}`, result);
    return result;
  } catch (e) {
    if (e instanceof HttpError && (e.status === 401 || e.status === 403)) {
      return { status: 'error', message: 'PSA token rejected – check it in Settings' };
    }
    if (e instanceof HttpError && e.status === 404) {
      return { status: 'not-found', message: 'Cert not found' };
    }
    if (e instanceof HttpError && e.status === 429) {
      return { status: 'error', message: 'PSA daily quota reached (100 calls/day on free accounts)' };
    }
    return { status: 'error', message: 'PSA API unavailable' };
  }
}
