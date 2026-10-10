import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";
import { PresenceState } from "./presence-state";
export class ViewerPresence extends DurableObject<Env> {
  private sessions = new PresenceState();
  async fetch(request: Request) {
    if (request.method === "GET") return Response.json(this.sessions.count());
    const { id } = (await request.json()) as { id: string };
    return new Response(null, { status: this.sessions.touch(id) ? 204 : 503 });
  }
}
