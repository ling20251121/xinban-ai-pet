import { researchCsv } from "@/lib/evaluation";
import { handleApiError } from "@/lib/http";

export async function GET(request: Request): Promise<Response> {
  try {
    return new Response(await researchCsv(request), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": 'attachment; filename="xinban-adult-evaluation.csv"',
        "Content-Type": "text/csv; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) { return handleApiError(error); }
}
