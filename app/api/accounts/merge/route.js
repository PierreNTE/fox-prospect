import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { mergeAccounts } from "@/lib/account-merge";

export const dynamic = "force-dynamic";

// POST /api/accounts/merge { keepId, dropId } — fusionne dropId dans keepId.
export async function POST(request) {
  const { keepId, dropId } = await request.json().catch(() => ({}));
  try {
    return NextResponse.json(await mergeAccounts(getSupabase(), keepId, dropId));
  } catch (e) {
    return NextResponse.json({ error: `Fusion impossible : ${e.message}` }, { status: 400 });
  }
}
