import { describe, expect, it } from 'vitest';

import { createPhotoChatSseDecoder } from './contract';

describe('createPhotoChatSseDecoder', () => {
  it('parses only event: message payloads from chunked SSE data', () => {
    const decoder = createPhotoChatSseDecoder();
    const chunkA = 'event: message\ndata: {"type":"ack","request_id":"req_1","thread_id":5}\n\n';
    const chunkB = 'event: ping\ndata: {"ignored":true}\n\n';
    const chunkC = 'event: message\ndata: {"type":"context_state","request_id":"req_1","thread_id":5,"context_state":{"last_generated_asset_id":10,"working_asset_ids":[10],"pending_question":null,"last_action":null,"locale":"uz"}}\n\n';

    const first = decoder.push(chunkA.slice(0, 30));
    const second = decoder.push(chunkA.slice(30) + chunkB + chunkC);

    expect(first).toEqual([]);
    expect(second).toHaveLength(2);
    expect(second[0]).toMatchObject({
      type: 'ack',
      request_id: 'req_1',
      thread_id: 5,
    });
    expect(second[1]).toMatchObject({
      type: 'context_state',
      request_id: 'req_1',
      thread_id: 5,
      context_state: {
        last_generated_asset_id: 10,
        working_asset_ids: [10],
        locale: 'uz',
      },
    });
  });
});
