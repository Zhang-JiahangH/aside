/** Local synthetic supplier stream; never included in application code. */
export function streamedResponse(text = "A short answer", delayMs = 0) {
  let cancelled = false;
  let sequence = 0;
  const encoder = new TextEncoder();
  const item = {
    id: "msg-fixture",
    type: "message",
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text, annotations: [] }],
  };
  const response = {
    id: "response-fixture",
    object: "response",
    status: "completed",
    service_tier: "priority",
    output: [item],
    output_text: text,
  };
  return new Response(
    new ReadableStream<Uint8Array>({
      async start(controller) {
        const emit = (event: Record<string, unknown>) => {
          if (!cancelled)
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ ...event, sequence_number: sequence++ })}\n\n`,
              ),
            );
        };
        emit({
          type: "response.created",
          response: { ...response, status: "in_progress", output: [] },
        });
        emit({
          type: "response.output_item.added",
          output_index: 0,
          item: { ...item, status: "in_progress", content: [] },
        });
        emit({
          type: "response.content_part.added",
          output_index: 0,
          content_index: 0,
          item_id: item.id,
          part: { type: "output_text", text: "", annotations: [] },
        });
        for (const delta of text.match(/.{1,7}/gs) ?? []) {
          emit({
            type: "response.output_text.delta",
            output_index: 0,
            content_index: 0,
            item_id: item.id,
            delta,
            logprobs: [],
          });
          if (delayMs)
            await new Promise((resolve) => setTimeout(resolve, delayMs));
          if (cancelled) return;
        }
        emit({ type: "response.completed", response });
        if (!cancelled) controller.close();
      },
      cancel() {
        cancelled = true;
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}
