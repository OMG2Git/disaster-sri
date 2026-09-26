import type { Request, Response } from 'express';
import type { EventEnvelope } from '../../types.js';

/** Keeps the set of open SSE responses and fans events out to them. */
export class SseHub {
  private clients = new Set<Response>();

  constructor(private heartbeatMs = 15_000) {}

  get size() {
    return this.clients.size;
  }

  connect(req: Request, res: Response) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // stop nginx-style proxies from buffering the stream
    });
    res.write('retry: 3000\n\n'); // browser reconnect delay
    this.clients.add(res);

    // Comment lines keep idle connections alive through proxies/load balancers.
    const heartbeat = setInterval(() => res.write(': ping\n\n'), this.heartbeatMs);
    req.on('close', () => {
      clearInterval(heartbeat);
      this.clients.delete(res);
    });
  }

  broadcast(event: EventEnvelope) {
    const frame = `id: ${event.event_id}\nevent: ${event.event_type}\ndata: ${JSON.stringify(event)}\n\n`;
    for (const client of this.clients) client.write(frame);
  }

  closeAll() {
    for (const client of this.clients) client.end();
    this.clients.clear();
  }
}
