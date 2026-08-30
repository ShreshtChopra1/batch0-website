import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  // Excluded from middleware entirely: Next.js internals, static assets by
  // extension (txt/xml cover the prerendered robots.txt, sitemap.xml and
  // llms.txt), the three webhooks that authenticate by signature instead of
  // session, and the demo-day reaction endpoint — its GET is anonymous and
  // its POST authenticates via its own Supabase client, so like the webhooks
  // it forgoes proactive token refresh rather than paying full session work
  // on a 4-second poll.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|logo.svg|og.png|api/stripe/webhook|api/discord/interactions|api/resend/webhook|api/demo-day/reactions|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|txt|xml)$).*)",
  ],
};
