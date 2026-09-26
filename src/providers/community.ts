import { z } from 'zod';
import { ExternalServiceError, type CommunityReportsProvider, type ExternalReport } from './types.js';

const responseSchema = z.object({
  reports: z.array(
    z.object({
      id: z.string(),
      source: z.string(),
      author: z.string().nullable().optional(),
      content: z.string(),
      reported_at: z.string().datetime({ offset: true }),
    }),
  ),
});

export class HttpCommunityReportsProvider implements CommunityReportsProvider {
  constructor(
    private baseUrl: string,
    private timeoutMs: number,
    private scenario?: string,
  ) {}

  async fetchReports({ query, disasterId }: { query: string; disasterId: string }): Promise<ExternalReport[]> {
    const params = new URLSearchParams({ query, disasterId });
    if (this.scenario) params.set('scenario', this.scenario);

    let body: unknown;
    try {
      const res = await fetch(`${this.baseUrl}/external/community-reports?${params}`, {
        signal: AbortSignal.timeout(this.timeoutMs), // one attempt, small timeout, no retry loop
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      body = await res.json();
    } catch (e) {
      throw new ExternalServiceError('community-api', e instanceof Error ? e.message : String(e));
    }

    const parsed = responseSchema.safeParse(body);
    if (!parsed.success) throw new ExternalServiceError('community-api', 'unexpected response shape');
    return parsed.data.reports.map((r) => ({ ...r, author: r.author ?? null }));
  }
}
