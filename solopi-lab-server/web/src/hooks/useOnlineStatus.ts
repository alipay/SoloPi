import { useEffect, useState } from 'react';

/** 浏览器在线状态（真实 navigator.onLine + window online/offline 事件） */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState<boolean>(
    () => (typeof navigator === 'undefined' ? true : navigator.onLine),
  );

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return online;
}
