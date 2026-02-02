import { createClient, type RealtimeChannel } from '@supabase/supabase-js';
import { getValidSession } from './supabase-auth';
import {
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
  getAuthenticatedHeaders,
  isSupabaseSyncConfigured,
  supabaseFetch,
} from './supabase-sync-core';

// ==================== PRODUCER CHAT ====================

export interface SupabaseChatMessage {
  id: string;
  sender_id: string;
  sender_name: string;
  message: string;
  created_at: string;
  sender_role?: string;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  senderAvatar?: string;
  senderRole?: 'producer' | 'pro' | 'admin' | 'client';
  content: string;
  createdAt: number;
}

const CHAT_SEND_LIMIT = {
  windowMs: 10 * 1000,
  maxMessages: 5,
};

const chatSendBuckets = new Map<string, number[]>();

function canSendChatMessage(senderId: string): boolean {
  const now = Date.now();
  const existing = chatSendBuckets.get(senderId) ?? [];
  const recent = existing.filter((ts) => now - ts < CHAT_SEND_LIMIT.windowMs);

  if (recent.length >= CHAT_SEND_LIMIT.maxMessages) {
    chatSendBuckets.set(senderId, recent);
    return false;
  }

  recent.push(now);
  chatSendBuckets.set(senderId, recent);
  return true;
}

// Convert Supabase message to app format
function supabaseToChatMessage(msg: SupabaseChatMessage): ChatMessage {
  return {
    id: msg.id,
    senderId: msg.sender_id,
    senderName: msg.sender_name,
    senderAvatar: undefined,
    senderRole: msg.sender_role as ChatMessage['senderRole'],
    content: msg.message,
    createdAt: new Date(msg.created_at).getTime(),
  };
}

// Envoyer un message
export async function sendChatMessage(
  senderId: string,
  senderName: string,
  _senderAvatar: string | null,
  content: string
): Promise<ChatMessage | null> {
  if (!isSupabaseSyncConfigured()) {
    return null;
  }

  if (!canSendChatMessage(senderId)) {
    console.warn('[Chat] Send throttled');
    return null;
  }

  try {
    // Utiliser les headers authentifiés pour que RLS puisse vérifier auth.uid()
    const headers = await getAuthenticatedHeaders();
    const url = `${SUPABASE_URL}/rest/v1/chat_messages`;
    const body = {
      sender_id: senderId,
      sender_name: senderName,
      producer_name: senderName, // Requis par la table
      message: content,
    };

    const response = await supabaseFetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      console.warn('[Chat] Erreur envoi message:', response.status);
      return null;
    }

    const data = await response.json();
    if (data && data.length > 0) {
      return supabaseToChatMessage(data[0]);
    }
    return null;
  } catch (error) {
    console.warn('[Chat] Erreur envoi message:', error);
    return null;
  }
}

// Récupérer les messages (50 derniers)
export async function fetchChatMessages(
  limit: number = 50,
  before?: string
): Promise<ChatMessage[]> {
  if (!isSupabaseSyncConfigured()) {
    return [];
  }

  try {
    // Utiliser les headers authentifiés pour que RLS puisse vérifier auth.uid()
    const headers = await getAuthenticatedHeaders();
    let url = `${SUPABASE_URL}/rest/v1/chat_messages?order=created_at.desc&limit=${limit}`;
    if (before) {
      url += `&created_at=lt.${before}`;
    }

    const response = await supabaseFetch(url, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      console.warn('[Chat] Erreur fetch messages:', response.status);
      return [];
    }

    const data: SupabaseChatMessage[] = await response.json();

    // Récupérer les rôles des senders
    const senderIds = [...new Set(data.map((m) => m.sender_id))];
    if (senderIds.length > 0) {
      const rolesUrl = `${SUPABASE_URL}/rest/v1/profiles?id=in.(${senderIds.join(',')})&select=id,role`;
      const rolesResponse = await supabaseFetch(rolesUrl, {
        method: 'GET',
        headers,
      });

      if (rolesResponse.ok) {
        const rolesData: Array<{ id: string; role: string }> = await rolesResponse.json();
        const rolesMap = new Map(rolesData.map((r) => [r.id, r.role]));

        // Ajouter le rôle à chaque message
        data.forEach((msg) => {
          msg.sender_role = rolesMap.get(msg.sender_id);
        });
      }
    }

    // Inverser pour avoir les plus anciens en premier
    return data.map(supabaseToChatMessage).reverse();
  } catch (error) {
    console.warn('[Chat] Erreur fetch messages:', error);
    return [];
  }
}

// ==================== WEBSOCKET CHAT AVEC RECONNEXION ====================

const supabaseRealtimeClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

let realtimeChannel: RealtimeChannel | null = null;
let realtimeCallback: ((message: ChatMessage) => void) | null = null;
let lastSubscribeCallback: ((message: ChatMessage) => void) | null = null;

// Connection state listeners
export type ChatConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'reconnecting' | 'error';
type ConnectionStateListener = (status: ChatConnectionStatus, message?: string) => void;
const connectionStateListeners: Set<ConnectionStateListener> = new Set();

let currentConnectionStatus: ChatConnectionStatus = 'disconnected';

function setConnectionStatus(status: ChatConnectionStatus, message?: string) {
  currentConnectionStatus = status;
  connectionStateListeners.forEach((listener) => listener(status, message));
}

// Subscribe to connection state changes
export function onChatConnectionStateChange(listener: ConnectionStateListener): () => void {
  connectionStateListeners.add(listener);
  // Immediately notify of current state
  listener(currentConnectionStatus);
  return () => {
    connectionStateListeners.delete(listener);
  };
}

// Get current connection status
export function getChatConnectionStatus(): ChatConnectionStatus {
  return currentConnectionStatus;
}

// Message queue for offline messages
let pendingMessages: Array<{
  senderId: string;
  senderName: string;
  content: string;
  timestamp: number;
}> = [];

// Queue a message to send when reconnected
export function queueChatMessage(senderId: string, senderName: string, content: string): void {
  pendingMessages.push({
    senderId,
    senderName,
    content,
    timestamp: Date.now(),
  });
}

// Send all pending messages
async function sendPendingMessages(): Promise<void> {
  if (pendingMessages.length === 0) return;
  const messagesToSend = [...pendingMessages];
  pendingMessages = [];

  for (const msg of messagesToSend) {
    // Don't send messages older than 5 minutes
    if (Date.now() - msg.timestamp > 5 * 60 * 1000) {
      continue;
    }
    await sendChatMessage(msg.senderId, msg.senderName, null, msg.content);
  }
}

async function ensureRealtimeAuth(): Promise<void> {
  const session = await getValidSession();
  if (session?.access_token) {
    supabaseRealtimeClient.realtime.setAuth(session.access_token);
  }
}

// S'abonner aux nouveaux messages en temps réel
export function subscribeToMessages(callback: (message: ChatMessage) => void): () => void {
  if (!isSupabaseSyncConfigured()) {
    return () => {};
  }

  realtimeCallback = callback;
  lastSubscribeCallback = callback;
  setConnectionStatus('connecting');

  ensureRealtimeAuth().catch(() => {
    // Continue with anon auth if session isn't available
  });

  if (realtimeChannel) {
    supabaseRealtimeClient.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }

  realtimeChannel = supabaseRealtimeClient
    .channel('chat-room')
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_messages',
      },
      (payload) => {
        const record = payload.new as SupabaseChatMessage;
        const message = supabaseToChatMessage(record);
        realtimeCallback?.(message);
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        setConnectionStatus('connected');
        sendPendingMessages();
        return;
      }

      if (status === 'CLOSED') {
        setConnectionStatus('disconnected');
        return;
      }

      if (status === 'TIMED_OUT' || status === 'CHANNEL_ERROR') {
        setConnectionStatus('error', 'Erreur de connexion au chat');
      }
    });

  // Retourner une fonction de cleanup
  return () => {
    realtimeCallback = null;

    if (realtimeChannel) {
      supabaseRealtimeClient.removeChannel(realtimeChannel);
      realtimeChannel = null;
    }

    setConnectionStatus('disconnected');
  };
}

// Force reconnect (e.g., when app comes to foreground)
export function forceReconnectChat(): void {
  if (!lastSubscribeCallback) {
    return;
  }

  if (realtimeChannel) {
    supabaseRealtimeClient.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }

  subscribeToMessages(lastSubscribeCallback);
}

// Supprimer un message (admin uniquement)
export async function deleteChatMessage(messageId: string): Promise<boolean> {
  if (!isSupabaseSyncConfigured()) {
    return false;
  }

  try {
    const headers = await getAuthenticatedHeaders();
    const response = await supabaseFetch(
      `${SUPABASE_URL}/rest/v1/chat_messages?id=eq.${messageId}`,
      {
        method: 'DELETE',
        headers,
      }
    );

    if (!response.ok) {
      console.warn('[Chat] Erreur suppression message');
      return false;
    }
    return true;
  } catch (error) {
    console.warn('[Chat] Erreur suppression message:', error);
    return false;
  }
}

// Compter les producteurs en ligne (présence simulée basée sur l'activité récente)
export async function getOnlineProducersCount(): Promise<number> {
  if (!isSupabaseSyncConfigured()) {
    return 1;
  }

  try {
    // Compter les producteurs qui ont envoyé un message dans les 5 dernières minutes
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const headers = await getAuthenticatedHeaders();

    const response = await supabaseFetch(
      `${SUPABASE_URL}/rest/v1/chat_messages?created_at=gte.${fiveMinutesAgo}&select=sender_id`,
      {
        method: 'GET',
        headers,
      }
    );

    if (!response.ok) {
      return 1;
    }

    const data = await response.json();
    // Compter les sender_id uniques
    const uniqueSenders = new Set(data.map((m: { sender_id: string }) => m.sender_id));
    return Math.max(1, uniqueSenders.size);
  } catch (error) {
    console.warn('[Chat] Erreur count online:', error);
    return 1;
  }
}
