import { NextRequest } from "next/server";
import { json, protectedHandler } from "@/lib/scout/auth";
import {
  eligibility,
  maskEmail,
  normalizeEmail,
  matchesRole,
} from "@/lib/scout/policy";
import { snapshot } from "@/lib/scout/service";
import { ScoutError } from "@/lib/scout/config";
import { db } from "@/lib/scout/db";
import type { Candidate, ConsentEvidence } from "@/lib/scout/types";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(req: NextRequest) {
  return protectedHandler(req, async (staff) => {
    const query = (req.nextUrl.searchParams.get("q") || "")
      .trim()
      .slice(0, 100);
    const role = req.nextUrl.searchParams.get("role") || "";
    const id = req.nextUrl.searchParams.get("id");
    const page = Math.max(
      0,
      Math.min(1000, Number(req.nextUrl.searchParams.get("page")) || 0),
    );
    const s = await snapshot();
    if (id) {
      const c = s.candidates.find((c) => c.id === id);
      if (!c) throw new ScoutError("候補者が見つかりません", 404);
      await db("scout_audit", {
        method: "POST",
        body: JSON.stringify({
          staff_id: staff.id,
          event: "candidate_viewed",
          detail: { candidateId: id },
        }),
      });
      const e = eligibility(c, s.candidates, s.evidence, s.suppressed);
      return json({
        candidate: c,
        eligibility: { allowed: e.allowed, reasons: e.reasons },
        checkedAt: new Date().toISOString(),
      });
    }
    const byEmail = new Map<string, Candidate[]>(),
      proofByEmail = new Map<string, ConsentEvidence[]>();
    for (const c of s.candidates) {
      const key = normalizeEmail(c.email);
      byEmail.set(key, [...(byEmail.get(key) || []), c]);
    }
    for (const e of s.evidence) {
      const key = normalizeEmail(e.email);
      proofByEmail.set(key, [...(proofByEmail.get(key) || []), e]);
    }
    const rows = s.candidates
      .filter(
        (c) =>
          !c.isTest &&
          (!query ||
            `${c.name} ${c.region} ${c.qualifications}`.includes(query)) &&
          matchesRole(c.role, role),
      )
      .map((c) => {
        const key = normalizeEmail(c.email);
        const e = eligibility(
          c,
          byEmail.get(key) || [],
          proofByEmail.get(key) || [],
          s.suppressed,
        );
        return {
          id: c.id,
          name: c.name,
          role: c.role,
          region: c.region,
          qualifications: c.qualifications,
          status: c.status,
          appliedAt: c.appliedAt,
          email: maskEmail(c.email),
          allowed: e.allowed,
          reasons: e.reasons,
        };
      });
    rows.sort(
      (a, b) =>
        Number(b.allowed) - Number(a.allowed) ||
        (b.appliedAt || "").localeCompare(a.appliedAt || "") ||
        a.id.localeCompare(b.id),
    );
    return json({
      candidates: rows.slice(page * 30, page * 30 + 30),
      total: rows.length,
      eligible: rows.filter((c) => c.allowed).length,
      page,
      checkedAt: new Date().toISOString(),
    });
  });
}
