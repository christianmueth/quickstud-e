export const TUTOR_CHAT_ENABLED_STORAGE_KEY = "quickstud:tutor-chat-enabled";
export const TUTOR_CHAT_ENABLED_EVENT = "quickstud:tutor-chat-enabled";

export function readTutorChatEnabled() {
  if (typeof window === "undefined") return true;

  const stored = window.localStorage.getItem(TUTOR_CHAT_ENABLED_STORAGE_KEY);
  if (stored === "0") return false;
  return true;
}

export function setTutorChatEnabled(enabled: boolean) {
  if (typeof window === "undefined") return;

  window.localStorage.setItem(TUTOR_CHAT_ENABLED_STORAGE_KEY, enabled ? "1" : "0");
  window.dispatchEvent(
    new CustomEvent(TUTOR_CHAT_ENABLED_EVENT, {
      detail: { enabled },
    })
  );
}