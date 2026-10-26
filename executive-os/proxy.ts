import { NextResponse, type NextRequest } from "next/server";

// Basic auth for the whole app when APP_SECRET is set (any username, password = APP_SECRET).
// Vercel Cron calls carry `Authorization: Bearer $CRON_SECRET` instead.
export function proxy(req: NextRequest) {
  const secret = process.env.APP_SECRET;
  if (!secret) return NextResponse.next();
  const auth = req.headers.get("authorization") ?? "";
  if (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`) return NextResponse.next();
  if (auth.startsWith("Basic ")) {
    const [, pass] = atob(auth.slice(6)).split(":");
    if (pass === secret) return NextResponse.next();
  }
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "www-authenticate": 'Basic realm="Executive OS"' },
  });
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
