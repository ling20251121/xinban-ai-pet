import { requireStudentIdentity } from "@/lib/auth";
import { deleteStudentContent } from "@/lib/student-data";
import { ensureStrictSameOrigin, handleApiError, jsonResponse } from "@/lib/http";

export async function DELETE(request: Request): Promise<Response> {
  try {
    ensureStrictSameOrigin(request);
    const { user } = await requireStudentIdentity(request);
    return jsonResponse({ ok: true, deleted: await deleteStudentContent(user) });
  } catch (error) {
    return handleApiError(error);
  }
}
