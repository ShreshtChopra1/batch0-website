/**
 * Daily connection doctor: prove the live-video integration end to end.
 *
 * Usage:
 *   npm run daily-doctor
 *   npm run daily-doctor -- --keep     # leave the room up and print join URLs
 *
 * Walks the exact chain lib/daily.ts depends on, in order, so a failure names
 * the link that broke instead of surfacing later as "the webinar didn't work":
 *
 *   credentials -> domain match -> create private room -> mint owner token
 *   -> mint viewer token -> verify the two differ in the ways that matter
 *   -> delete the room
 *
 * It creates and then deletes one room, which costs nothing (billing is per
 * participant-minute, and nobody joins). With --keep the room survives and the
 * script prints two join URLs so you can open them in two browsers and see the
 * host/viewer split for real.
 *
 * The token checks are the point. `is_owner` and `hasPresence` are what make
 * a webinar a webinar rather than a group call where students can broadcast
 * and count each other, and both are invisible until something goes wrong in
 * front of an audience. Asserting them here is cheap.
 */

const API = "https://api.daily.co/v1";

const keep = process.argv.includes("--keep");

function env(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(
      `Missing ${name}.\n` +
        "Run with: node --env-file=.env.local scripts/daily-doctor.mts\n" +
        "(or `npm run daily-doctor`, which does that for you)",
    );
    process.exit(1);
  }
  return v;
}

const KEY = env("DAILY_API_KEY");
const DOMAIN = env("NEXT_PUBLIC_DAILY_DOMAIN");

async function call<T>(
  path: string,
  init: { method: string; body?: unknown } = { method: "GET" },
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) {
    throw new Error(
      `${init.method} ${path} -> ${res.status} ${await res.text()}`,
    );
  }
  return (await res.json()) as T;
}

/** Meeting tokens are JWTs; the payload is what we actually want to assert. */
function decodeJwt(token: string): Record<string, any> {
  const payload = token.split(".")[1];
  if (!payload) throw new Error("token is not a JWT");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

const pass = (m: string) => console.log(`  ok    ${m}`);
const info = (m: string) => console.log(`        ${m}`);
let failures = 0;
function check(cond: boolean, m: string) {
  if (cond) pass(m);
  else {
    failures++;
    console.log(`  FAIL  ${m}`);
  }
}

async function main() {
  console.log("\ndaily-doctor\n");

  // 1. Credentials + domain ------------------------------------------------
  console.log("credentials");
  const me = await call<{ domain_name: string }>("/");
  pass(`authenticated as domain "${me.domain_name}"`);

  const expected = DOMAIN.replace(/^https?:\/\//, "").split(".")[0];
  check(
    me.domain_name === expected,
    `NEXT_PUBLIC_DAILY_DOMAIN (${DOMAIN}) matches the key's domain`,
  );
  if (me.domain_name !== expected) {
    info(
      `key belongs to "${me.domain_name}" but the env var says "${expected}" —`,
    );
    info("room URLs would point somewhere the tokens aren't valid for.");
  }

  // 2. Room ----------------------------------------------------------------
  console.log("\nroom");
  const expiresAt = Math.floor(Date.now() / 1000) + 30 * 60;
  const room = await call<{ name: string; url: string; privacy: string }>(
    "/rooms",
    {
      method: "POST",
      body: {
        name: `doctor-${Date.now().toString(36)}`,
        privacy: "private",
        properties: {
          exp: expiresAt,
          eject_at_room_exp: true,
          owner_only_broadcast: true,
          enable_screenshare: true,
          enable_chat: true,
          enable_prejoin_ui: false,
          experimental_optimize_large_calls: true,
        },
      },
    },
  );
  pass(`created ${room.name}`);
  check(room.privacy === "private", "room is private (URL alone can't join)");

  const created = await call<{ config: Record<string, any> }>(
    `/rooms/${room.name}`,
  );
  check(
    created.config?.owner_only_broadcast === true,
    "owner_only_broadcast is on (webinar mode: only hosts get camera/mic)",
  );
  check(
    typeof created.config?.exp === "number",
    "room expires on its own (no orphaned rooms to clean up)",
  );

  // 3. Tokens --------------------------------------------------------------
  console.log("\ntokens");
  const mint = (isOwner: boolean) =>
    call<{ token: string }>("/meeting-tokens", {
      method: "POST",
      body: {
        properties: {
          room_name: room.name,
          user_id: isOwner ? "doctor-host" : "doctor-viewer",
          user_name: isOwner ? "Host" : "Student",
          is_owner: isOwner,
          exp: expiresAt,
          eject_at_token_exp: true,
          ...(isOwner ? {} : { permissions: { hasPresence: false } }),
          enable_recording: isOwner ? "cloud" : false,
        },
      },
    });

  const { token: hostToken } = await mint(true);
  const { token: viewerToken } = await mint(false);
  const host = decodeJwt(hostToken);
  const viewer = decodeJwt(viewerToken);

  // Daily abbreviates its JWT claims, and the short names are not documented
  // alongside the REST properties that set them. Asserting the wrong key
  // reads as a broken integration when nothing is wrong, so the mapping is
  // written down here:
  //
  //   o   is_owner          u    user_name       er   enable_recording
  //   r   room_name         ud   user_id         ejt  eject_at_token_exp
  //   p   permissions       p.hp permissions.hasPresence
  check(host.o === true, "host token carries is_owner (o)");
  check(viewer.o === false, "viewer token does NOT carry is_owner");
  check(
    host.r === room.name && viewer.r === room.name,
    "both tokens are scoped to this room only",
  );
  check(
    typeof host.exp === "number" && typeof viewer.exp === "number",
    "both tokens expire",
  );
  check(
    host.er === "cloud" && !viewer.er,
    "only the host may start a recording",
  );

  // The audience-privacy guarantee. If this regresses, students can see how
  // many people are watching — the requirement this whole feature hangs on.
  const hasPresence = viewer.p?.hp;
  check(
    hasPresence === false,
    "viewer token sets hasPresence:false (absent from others' participant list)",
  );
  if (hasPresence !== false) {
    info(`viewer permissions decoded as: ${JSON.stringify(viewer.p)}`);
    info("students would be visible to each other — check the token properties.");
  }
  check(
    host.p?.hp !== false,
    "host token does NOT hide the host (they must be visible to the audience)",
  );

  // 4. Cleanup -------------------------------------------------------------
  console.log("\ncleanup");
  if (keep) {
    info("--keep set, leaving the room up. Open these in two browsers:");
    console.log(`\n  HOST    ${room.url}?t=${hostToken}`);
    console.log(`  STUDENT ${room.url}?t=${viewerToken}\n`);
    info(`the room self-destructs at ${new Date(expiresAt * 1000).toLocaleTimeString()}`);
  } else {
    await call(`/rooms/${room.name}`, { method: "DELETE" });
    pass("deleted the test room");
  }

  console.log(
    failures === 0
      ? "\nAll checks passed — live video is wired up correctly.\n"
      : `\n${failures} check(s) FAILED — see above.\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("\ndaily-doctor failed:\n", err instanceof Error ? err.message : err);
  process.exit(1);
});
