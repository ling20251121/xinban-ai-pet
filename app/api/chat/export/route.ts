import { requireStudentIdentity } from "@/lib/auth";
import { exportConversations } from "@/lib/conversations";
import { handleApiError } from "@/lib/http";

export async function GET(request: Request): Promise<Response> {
  try {
    const { user } = await requireStudentIdentity(request);
    const exported = await exportConversations(user.id);
    return new Response(JSON.stringify(exported), {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="xinban-chat-${new Date().toISOString().slice(0, 10)}.json"`,
        "Content-Type": "application/json; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
