import { useCallback, useEffect, useRef, useState } from 'react';
import { formatSingaporeDate } from '@/lib/timezone';

const POLL_INTERVAL_MS = 30_000;

interface ReminderPayload {
  id: number;
  title: string;
  dueDate: string | null;
  reminderMinutes: number | null;
  priority: 'high' | 'medium' | 'low';
}

type UseNotificationsResult = {
  isSupported: boolean;
  permission: NotificationPermission;
  isPolling: boolean;
  error: string | null;
  enableNotifications: () => Promise<NotificationPermission>;
};

export function useNotifications(): UseNotificationsResult {
  const isClient = typeof window !== 'undefined';
  const isSupported = isClient && 'Notification' in window;
  const [permission, setPermission] = useState<NotificationPermission>(() => {
    if (!isSupported) {
      return 'default';
    }
    return Notification.permission;
  });
  const [isPolling, setIsPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isSupported) {
      return undefined;
    }
    setPermission(Notification.permission);
    return undefined;
  }, [isSupported]);

  const enableNotifications = useCallback(async () => {
    if (!isSupported) {
      setError('Browser notifications are not supported.');
      return 'denied';
    }

    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== 'granted') {
        setError('Permission denied. Enable notifications in your browser settings.');
      } else {
        setError(null);
      }
      return result;
    } catch (requestError) {
      const message = (requestError as Error).message ?? 'Failed to enable notifications';
      setError(message);
      return 'denied';
    }
  }, [isSupported]);

  useEffect(() => {
    if (!isSupported || permission !== 'granted') {
      if (intervalRef.current != null && isClient) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      setIsPolling(false);
      return undefined;
    }

    let isCancelled = false;

    const runCheck = async () => {
      if (!isSupported) {
        return;
      }

      try {
        const response = await fetch('/api/notifications/check', { cache: 'no-store' });
        if (!response.ok) {
          throw new Error('Failed to check reminders');
        }

        const payload = (await response.json()) as { todos?: ReminderPayload[] };
        const todos = payload.todos ?? [];
        if (todos.length === 0) {
          setError(null);
          return;
        }

        for (const todo of todos) {
          if (!isSupported) {
            break;
          }

          const body = todo.dueDate ? `Due ${formatSingaporeDate(todo.dueDate)}` : 'Due soon';
          const tag = `todo-reminder-${todo.id}`;
          new Notification(todo.title, {
            body,
            tag,
            data: { todoId: todo.id, reminderMinutes: todo.reminderMinutes, priority: todo.priority }
          });
        }

        setError(null);
      } catch (pollError) {
        if (!isCancelled) {
          setError((pollError as Error).message ?? 'Failed to check reminders');
        }
      }
    };

    runCheck();
    if (isClient) {
      intervalRef.current = window.setInterval(runCheck, POLL_INTERVAL_MS);
    }
    setIsPolling(true);

    return () => {
      isCancelled = true;
      if (intervalRef.current != null && isClient) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      setIsPolling(false);
    };
  }, [isClient, isSupported, permission]);

  return {
    isSupported,
    permission,
    isPolling,
    error,
    enableNotifications
  };
}
