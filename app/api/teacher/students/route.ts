import { createStudent, listStudents, updateStudent } from "@/lib/accounts";
import { requireTeacher } from "@/lib/auth";
import { ensureStrictSameOrigin, handleApiError, jsonResponse, readJsonBody } from "@/lib/http";
import { asObject } from "@/lib/validation";

export async function GET(request: Request): Promise<Response> {
  try {
    const { user } = await requireTeacher(request);
    const classId = new URL(request.url).searchParams.get("classId");
    return jsonResponse({ students: await listStudents(user.id, classId) });
  } catch (error) { return handleApiError(error); }
}

export async function POST(request: Request): Promise<Response> {
  try {
    ensureStrictSameOrigin(request);
    const { user } = await requireTeacher(request);
    const student = await createStudent(
      request,
      user,
      asObject(await readJsonBody<unknown>(request)),
    );
    return jsonResponse({ ok: true, student }, 201);
  } catch (error) { return handleApiError(error); }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    ensureStrictSameOrigin(request);
    const { user } = await requireTeacher(request);
    const student = await updateStudent(user, asObject(await readJsonBody<unknown>(request)));
    return jsonResponse({ ok: true, student });
  } catch (error) { return handleApiError(error); }
}
