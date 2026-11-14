import { apiRequest } from '@/lib/conversation-api';

export const RELATIONSHIPS = ['FRIEND', 'ROOMMATE', 'SIBLING', 'FAMILY', 'PARTNER', 'MENTOR', 'COUNSELLOR', 'OTHER'] as const;
export type Relationship = (typeof RELATIONSHIPS)[number];
export type Channel = 'WHATSAPP' | 'SMS';

export const RELATIONSHIP_LABEL: Record<Relationship, string> = {
  FRIEND: 'Friend', ROOMMATE: 'Roommate', SIBLING: 'Sibling', FAMILY: 'Family', PARTNER: 'Partner',
  MENTOR: 'Mentor', COUNSELLOR: 'Counsellor', OTHER: 'Other',
};

export type Contact = { id: string; name: string; phoneMasked: string; relationship: Relationship; channel: Channel; priority: number };
export type PendingPrompt = { id: string; level: 'LOW' | 'ELEVATED' | 'URGENT'; source: 'VOICE' | 'CHECKIN'; expiresAt: string };
export type ContactNotification = {
  id: string; contactLabel: string; channel: Channel; body: string; status: 'QUEUED' | 'SENT' | 'FAILED'; createdAt: string; sentAt: string | null;
};
export type MessageLang = 'en' | 'hi';

export const listContacts = (token: string) => apiRequest<Contact[]>('/api/contacts', { token });
export const addContact = (token: string, body: { name: string; phone: string; relationship: Relationship; channel: Channel }) =>
  apiRequest<Contact>('/api/contacts', { method: 'POST', token, body });
export const updateContact = (token: string, id: string, body: { name?: string; relationship?: Relationship; channel?: Channel }) =>
  apiRequest<Contact>(`/api/contacts/${id}`, { method: 'PATCH', token, body });
export const reorderContacts = (token: string, ids: string[]) => apiRequest<Contact[]>('/api/contacts/order', { method: 'PUT', token, body: { ids } });
export const deleteContact = (token: string, id: string) => apiRequest<void>(`/api/contacts/${id}`, { method: 'DELETE', token });

/** The exact text a contact would get, shown to the student before anything is sent. */
export const previewMessage = (token: string, lang: MessageLang) =>
  apiRequest<{ text: string; lang: MessageLang }>(`/api/contacts/message-preview?lang=${lang}`, { token });

export const getPendingPrompt = (token: string) => apiRequest<PendingPrompt | null>('/api/support-prompts/pending', { token });
export const respondToPrompt = (token: string, id: string, body: { action: 'message' | 'call' | 'decline' | 'snooze'; contactId?: string; lang?: MessageLang }) =>
  apiRequest<{ status: string; tel?: string | null }>(`/api/support-prompts/${id}/respond`, { method: 'POST', token, body });

export const listContactNotifications = (token: string) => apiRequest<ContactNotification[]>('/api/contact-notifications', { token });
