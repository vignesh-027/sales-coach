import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/services/supabase/server";
import { getUserByAuthId } from "@/services/supabase/queries/users";
import {
  getAppSettings,
  updateLlmModel,
  updateRerankModel,
  updateTranscriptionModel,
} from "@/services/supabase/queries/app-settings";
import { isAllowedLlmModel, LLM_OPTIONS } from "@/services/anthropic/models";
import {
  isAllowedRerankModel,
  RERANK_OPTIONS,
} from "@/services/voyage/rerank-models";
import {
  isAllowedTranscriptionModel,
  TRANSCRIPTION_OPTIONS,
} from "@/services/transcription/models";

export const runtime = "nodejs";

async function requireAdmin() {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  const me = await getUserByAuthId(data.user.id);
  if (!me?.is_admin) return null;
  return me;
}

export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const settings = await getAppSettings();
  return NextResponse.json({
    settings,
    llm_options: LLM_OPTIONS,
    rerank_options: RERANK_OPTIONS,
    transcription_options: TRANSCRIPTION_OPTIONS,
  });
}

interface PatchBody {
  llm_model?: string;
  rerank_model?: string;
  transcription_model?: string;
}

export async function PATCH(req: NextRequest) {
  const me = await requireAdmin();
  if (!me) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const hasLlm = typeof body.llm_model === "string" && body.llm_model.trim();
  const hasRerank =
    typeof body.rerank_model === "string" && body.rerank_model.trim();
  const hasTranscription =
    typeof body.transcription_model === "string" &&
    body.transcription_model.trim();

  if (!hasLlm && !hasRerank && !hasTranscription) {
    return NextResponse.json(
      {
        error:
          "llm_model, rerank_model, or transcription_model required",
      },
      { status: 400 },
    );
  }

  let updated = await getAppSettings();

  if (hasLlm) {
    if (!isAllowedLlmModel(body.llm_model!)) {
      return NextResponse.json(
        { error: `llm_model "${body.llm_model}" is not in the allow-list` },
        { status: 400 },
      );
    }
    updated = await updateLlmModel(body.llm_model!, me.id);
  }

  if (hasRerank) {
    if (!isAllowedRerankModel(body.rerank_model!)) {
      return NextResponse.json(
        {
          error: `rerank_model "${body.rerank_model}" is not in the allow-list`,
        },
        { status: 400 },
      );
    }
    updated = await updateRerankModel(body.rerank_model!, me.id);
  }

  if (hasTranscription) {
    if (!isAllowedTranscriptionModel(body.transcription_model!)) {
      return NextResponse.json(
        {
          error: `transcription_model "${body.transcription_model}" is not in the allow-list`,
        },
        { status: 400 },
      );
    }
    updated = await updateTranscriptionModel(body.transcription_model!, me.id);
  }

  return NextResponse.json({ settings: updated });
}
