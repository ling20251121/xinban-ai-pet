import { createClass, listClasses } from "@/lib/accounts";
import { requireTeacher } from "@/lib/auth";
import { ensureStrictSameOrigin, handleApiError, jsonResponse, readJsonBody } from "@/lib/http";
import { asObject } from "@/lib/validation";
import { getRuntimeEnv } from "@/db";
import { requireStudentMode } from "@/lib/public-demo";

export async function GET(request: Request): Promise<Response> {
  try {
    requireStudentMode(getRuntimeEnv());
    const { user } = await requireTeacher(request);
    return jsonResponse({ classes: await listClasses(user.id) });
  } catch (error) { return handleApiError(error); }
}

export async function POST(request: Request): Promise<Response> {
  try {
    requireStudentMode(getRuntimeEnv());
    ensureStrictSameOrigin(request);
    const { user } = await requireTeacher(request);
    const classroom = await createClass(user, asObject(await readJsonBody<unknown>(request)));
    return jsonResponse({ ok: true, classroom }, 201);
  } catch (error) { return handleApiError(error); }
}
