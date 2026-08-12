import { createClass, listClasses } from "@/lib/accounts";
import { requireTeacher } from "@/lib/auth";
import { ensureStrictSameOrigin, handleApiError, jsonResponse, readJsonBody } from "@/lib/http";
import { asObject } from "@/lib/validation";

export async function GET(request: Request): Promise<Response> {
  try {
    const { user } = await requireTeacher(request);
    return jsonResponse({ classes: await listClasses(user.id) });
  } catch (error) { return handleApiError(error); }
}

export async function POST(request: Request): Promise<Response> {
  try {
    ensureStrictSameOrigin(request);
    const { user } = await requireTeacher(request);
    const classroom = await createClass(user, asObject(await readJsonBody<unknown>(request)));
    return jsonResponse({ ok: true, classroom }, 201);
  } catch (error) { return handleApiError(error); }
}
