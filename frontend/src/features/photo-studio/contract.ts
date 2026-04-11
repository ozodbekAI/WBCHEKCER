export interface PhotoChatThreadContext {
  last_generated_asset_id: number | null;
  working_asset_ids: number[];
  pending_question: string | null;
  last_action: Record<string, unknown> | string | null;
  locale: string | null;
}

export interface PhotoChatAsset {
  asset_id: number;
  seq: number;
  kind: string;
  source: string;
  file_url: string;
  file_name: string;
  prompt: string | null;
  caption: string;
  meta: Record<string, unknown>;
}

export interface PhotoChatMessageRecord {
  id: number;
  role: string;
  msg_type: string;
  content: string | null;
  meta: Record<string, unknown> | null;
  created_at: string | null;
  thread_id: number | null;
  request_id: string | null;
}

export interface PhotoChatHistoryResponse {
  session_key: string;
  thread_id: number;
  active_thread_id: number;
  context_state: PhotoChatThreadContext;
  message_count: number;
  limit: number | null;
  locked: boolean;
  messages: PhotoChatMessageRecord[];
  assets: PhotoChatAsset[];
}

export type PhotoChatClearMode = 'messages' | 'context' | 'all';

export interface PhotoChatClearResponse {
  thread_id: number;
  active_thread_id: number;
  clear_mode: PhotoChatClearMode;
  deleted: number;
  deleted_media: number;
  context_state: PhotoChatThreadContext;
  message_count: number;
  limit: number | null;
  locked: boolean;
}

export interface PhotoChatDeleteResponse {
  thread_id: number;
  active_thread_id: number;
  deleted: number;
  deleted_media: number;
  message_count: number;
  limit: number | null;
  locked: boolean;
}

export interface PhotoChatUploadResponse {
  asset_id: number;
  seq: number;
  file_url: string;
  file_name: string;
  caption?: string | null;
}

export interface PhotoChatQuickAction {
  type?: string;
  action?: string;
  pose_prompt_id?: number;
  prompt_id?: number;
  scene_item_id?: number;
  item_id?: number;
  model_item_id?: number;
  new_model_prompt?: string;
  level?: string;
  prompt?: string;
  model?: string;
  duration?: number;
  resolution?: string;
}

export interface PhotoChatStreamRequest {
  message?: string;
  asset_ids?: number[];
  quick_action?: PhotoChatQuickAction;
  thread_id?: number;
  request_id?: string;
  locale?: string;
}

export type PhotoChatSsePayloadType =
  | 'ack'
  | 'chat'
  | 'question'
  | 'generation_start'
  | 'images_start'
  | 'image_started'
  | 'generation_complete'
  | 'error'
  | 'limit_reached'
  | 'context_state';

export interface PhotoChatSseBasePayload {
  type: PhotoChatSsePayloadType;
  request_id: string;
  thread_id: number;
}

export interface PhotoChatAckPayload extends PhotoChatSseBasePayload {
  type: 'ack';
  user_message_id?: number | null;
}

export interface PhotoChatChatPayload extends PhotoChatSseBasePayload {
  type: 'chat' | 'question';
  content?: string | null;
  message?: string | null;
  message_id?: number | null;
}

export interface PhotoChatGenerationStartPayload extends PhotoChatSseBasePayload {
  type: 'generation_start';
  prompt?: string | null;
}

export interface PhotoChatImagesStartPayload extends PhotoChatSseBasePayload {
  type: 'images_start';
  total?: number | null;
}

export interface PhotoChatImageStartedPayload extends PhotoChatSseBasePayload {
  type: 'image_started';
  index?: number | null;
  total?: number | null;
}

export interface PhotoChatGenerationCompletePayload extends PhotoChatSseBasePayload {
  type: 'generation_complete';
  image_url?: string | null;
  file_name?: string | null;
  prompt?: string | null;
  asset_id?: number | null;
  message_id?: number | null;
  index?: number | null;
  total?: number | null;
}

export interface PhotoChatErrorPayload extends PhotoChatSseBasePayload {
  type: 'error' | 'limit_reached';
  message?: string | null;
  content?: string | null;
  code?: string | null;
  retryable?: boolean | null;
  error?: {
    message?: string | null;
  } | null;
}

export interface PhotoChatContextStatePayload extends PhotoChatSseBasePayload {
  type: 'context_state';
  context_state: PhotoChatThreadContext;
}

export type PhotoChatSsePayload =
  | PhotoChatAckPayload
  | PhotoChatChatPayload
  | PhotoChatGenerationStartPayload
  | PhotoChatImagesStartPayload
  | PhotoChatImageStartedPayload
  | PhotoChatGenerationCompletePayload
  | PhotoChatErrorPayload
  | PhotoChatContextStatePayload;

function isSsePayloadType(value: unknown): value is PhotoChatSsePayloadType {
  return (
    value === 'ack' ||
    value === 'chat' ||
    value === 'question' ||
    value === 'generation_start' ||
    value === 'images_start' ||
    value === 'image_started' ||
    value === 'generation_complete' ||
    value === 'error' ||
    value === 'limit_reached' ||
    value === 'context_state'
  );
}

function parsePhotoChatSseBlock(block: string): PhotoChatSsePayload[] {
  const lines = block.split('\n');
  let eventName = 'message';
  const dataLines: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith(':')) continue;
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim();
      continue;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  if (eventName !== 'message' || dataLines.length === 0) {
    return [];
  }

  try {
    const payload = JSON.parse(dataLines.join('\n')) as Partial<PhotoChatSsePayload>;
    if (!isSsePayloadType(payload?.type)) {
      return [];
    }
    if (typeof payload?.request_id !== 'string' || typeof payload?.thread_id !== 'number') {
      return [];
    }
    return [payload as PhotoChatSsePayload];
  } catch {
    return [];
  }
}

export function createPhotoChatSseDecoder() {
  let buffer = '';

  return {
    push(chunk: string): PhotoChatSsePayload[] {
      if (!chunk) return [];
      buffer += chunk.replace(/\r\n/g, '\n');

      const payloads: PhotoChatSsePayload[] = [];
      let boundary = buffer.indexOf('\n\n');

      while (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        payloads.push(...parsePhotoChatSseBlock(block));
        boundary = buffer.indexOf('\n\n');
      }

      return payloads;
    },
    flush(): PhotoChatSsePayload[] {
      if (!buffer.trim()) {
        buffer = '';
        return [];
      }
      const payloads = parsePhotoChatSseBlock(buffer);
      buffer = '';
      return payloads;
    },
  };
}
