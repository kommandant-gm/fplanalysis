import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import axios from 'axios';

const SESSION_KEY = 'fpl_analytics_session_id';
const HEARTBEAT_INTERVAL_MS = 30_000;

function generateSessionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `sid_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function getSessionId() {
  let sid = localStorage.getItem(SESSION_KEY);
  if (!sid) {
    sid = generateSessionId();
    localStorage.setItem(SESSION_KEY, sid);
  }
  return sid;
}

function getViewport() {
  if (typeof window === 'undefined') return null;
  return `${window.innerWidth}x${window.innerHeight}`;
}

export default function AnalyticsTracker() {
  const location = useLocation();
  const sessionIdRef = useRef(null);
  const currentPathRef = useRef('/');
  const lastPageviewRef = useRef({ path: '', at: 0 });

  useEffect(() => {
    sessionIdRef.current = getSessionId();
  }, []);

  useEffect(() => {
    const path = `${location.pathname}${location.search || ''}`;
    currentPathRef.current = path;

    if (!sessionIdRef.current) return;
    const now = Date.now();
    if (lastPageviewRef.current.path === path && now - lastPageviewRef.current.at < 1500) {
      return;
    }
    lastPageviewRef.current = { path, at: now };

    axios.post('/api/analytics/pageview', {
      sessionId: sessionIdRef.current,
      path,
      title: document.title || null,
      referrer: document.referrer || null,
      viewport: getViewport(),
    }).catch(() => {
      // Analytics should never break the app UI.
    });
  }, [location.pathname, location.search]);

  useEffect(() => {
    const sendHeartbeat = () => {
      if (!sessionIdRef.current) return;
      if (document.visibilityState === 'hidden') return;

      axios.post('/api/analytics/heartbeat', {
        sessionId: sessionIdRef.current,
        path: currentPathRef.current,
      }).catch(() => {
        // Analytics should never break the app UI.
      });
    };

    sendHeartbeat();
    const t = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(t);
  }, []);

  return null;
}
