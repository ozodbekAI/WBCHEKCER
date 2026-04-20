import {
  applyStreamErrorToMessages,
  parseSsePayloads,
  upsertGeneratedPhoto,
  type StreamChatMessage,
} from "../lib/photoChatStream";

describe("photoChatStream helpers", () => {
  it("parses SSE payloads one by one across chunk boundaries", () => {
    let buffer = "";

    const first = parseSsePayloads(
      buffer,
      'event: message\ndata: {"type":"ack","thread_id":1}\n\n' +
        'event: message\ndata: {"type":"images_start","total":1}\n\n' +
        'event: message\ndata: {"type":"generation_complete","image_url":"https://example.com/a.png"',
    );
    buffer = first.buffer;

    expect(first.events).toEqual([
      { type: "ack", thread_id: 1 },
      { type: "images_start", total: 1 },
    ]);

    const second = parseSsePayloads(buffer, ',"asset_id":99}\n\n' + 'event: message\ndata: {"type":"context_state","context_state":{"last_generated_asset_id":99}}\n\n');
    expect(second.buffer).toBe("");
    expect(second.events).toEqual([
      { type: "generation_complete", image_url: "https://example.com/a.png", asset_id: 99 },
      { type: "context_state", context_state: { last_generated_asset_id: 99 } },
    ]);
  });

  it("dedupes generated media by asset id and keeps newest first", () => {
    const initial = [
      { id: "asset-10", assetId: 10, url: "https://example.com/10.png", type: "image" as const },
      { id: "asset-11", assetId: 11, url: "https://example.com/11.png", type: "image" as const },
    ];

    const next = upsertGeneratedPhoto(initial, {
      id: "asset-10-new",
      assetId: 10,
      url: "https://example.com/10-new.png",
      type: "image" as const,
    });

    expect(next).toEqual([
      { id: "asset-10-new", assetId: 10, url: "https://example.com/10-new.png", type: "image" },
      { id: "asset-11", assetId: 11, url: "https://example.com/11.png", type: "image" },
    ]);
  });

  it("replaces an existing loading bot message with an error instead of leaving spinner stuck", () => {
    const messages: StreamChatMessage[] = [
      {
        id: "user-1",
        role: "user",
        type: "text",
        content: "make it brighter",
        timestamp: new Date("2026-04-20T08:00:00Z"),
      },
      {
        id: "bot-1",
        role: "assistant",
        type: "action-progress",
        content: "Generating...",
        timestamp: new Date("2026-04-20T08:00:01Z"),
        isLoading: true,
      },
    ];

    const next = applyStreamErrorToMessages(messages, {
      botAdded: true,
      botMsgId: "bot-1",
      errorText: "Ошибка соединения: timeout",
      now: new Date("2026-04-20T08:00:02Z"),
    });

    expect(next).toEqual([
      messages[0],
      {
        id: "bot-1",
        role: "assistant",
        type: "action-error",
        content: "Ошибка соединения: timeout",
        timestamp: new Date("2026-04-20T08:00:01Z"),
        isLoading: false,
      },
    ]);
  });
});
