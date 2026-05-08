// web/src/app/api/settings/wizard-mode/route.js
/**
 * Wizard Mode Settings API
 *
 * GET: returns { enabled: boolean }. False if the row is absent.
 * PUT: body { enabled: boolean }; upserts the row; returns { enabled: boolean }.
 */

import { getSetting, setSetting } from "@/lib/db";

const KEY = "wizard_mode_enabled";

export async function GET() {
  try {
    const raw = getSetting(KEY);
    const enabled = raw === "true";
    return Response.json({ enabled });
  } catch (error) {
    console.error("[Wizard Mode] GET failed:", error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    const body = await request.json();
    if (typeof body?.enabled !== "boolean") {
      return Response.json(
        { error: "enabled must be boolean" },
        { status: 400 }
      );
    }
    setSetting(KEY, body.enabled ? "true" : "false");
    return Response.json({ enabled: body.enabled });
  } catch (error) {
    console.error("[Wizard Mode] PUT failed:", error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
}
