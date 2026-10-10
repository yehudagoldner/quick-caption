import { setApiUser, apiFetch, apiAuthEpoch, apiUserUid } from "../api";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { adminRequest } from '../adminApi';
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import type { User } from "firebase/auth";
import { createDevAuthUser, isDevAuthBypass } from "../devAuth";

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  isDevBypass: boolean;
  connectionNotice: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  impersonation: Impersonation | null;
  startImpersonation: (uid: string) => Promise<void>;
  stopImpersonation: () => Promise<void>;
};

type Impersonation = { token: string; expiresAt: number; user: { uid: string; email: string | null; displayName: string | null;
  photoURL: string | null; phoneNumber: string | null; emailVerified: boolean; providerId: string | null } };
const impersonationKey = `${import.meta.env.BASE_URL}quickcaption:impersonation`;
const savedToken = () => { try { return sessionStorage.getItem(impersonationKey); } catch { return null; } };
const saveToken = (token: string | null) => { try { if (token) sessionStorage.setItem(impersonationKey, token); else sessionStorage.removeItem(impersonationKey); } catch { /* Storage may be disabled. */ } };

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

async function syncUser(user: User) {
  try {
    await apiFetch(`${(import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')}/api/users/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        photoURL: user.photoURL,
        phoneNumber: user.phoneNumber,
        emailVerified: user.emailVerified,
        providerId: user.providerData?.[0]?.providerId,
        lastLoginAt: user.metadata?.lastSignInTime ?? null,
      }),
    });
  } catch (error) {
    console.error("Failed to sync user", error);
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUserState] = useState<User | null>(() => {
    const initial = isDevAuthBypass ? createDevAuthUser() : null;
    setApiUser(initial);
    return initial;
  });
  const setUser = (next: User | null) => { setApiUser(next); setUserState(next); };
  const [loading, setLoading] = useState(!isDevAuthBypass);
  const [connectionNotice, setConnectionNotice] = useState<string | null>(null);
  const administrator = useRef<User | null>(null);
  const session = useRef<Impersonation | null>(null);
  const [impersonation, setImpersonation] = useState<Impersonation | null>(null);
  const applyImpersonation = (actor: User, next: Impersonation | null) => {
    session.current = next;
    setImpersonation(next);
    saveToken(next?.token ?? null);
    // Keep the real credential on the administrator; only the application profile changes.
    const effective = next ? { ...actor, ...next.user, getIdToken: actor.getIdToken.bind(actor) } as User : actor;
    setApiUser(effective, next?.token ?? null);
    setUserState(effective);
  };
  const handleStartImpersonation = async (uid: string) => {
    const actor = administrator.current;
    if (!actor || session.current) throw new Error('יש לחזור לניהול לפני כניסה למשתמש.');
    const next = await adminRequest<Impersonation>(actor, '/impersonation/start', { userUid: uid }, { administrator: true });
    if (administrator.current !== actor) return;
    setConnectionNotice(null);
    applyImpersonation(actor, next);
  };
  const handleStopImpersonation = async () => {
    const actor = administrator.current;
    const previous = session.current;
    if (!actor || !previous) return;
    // Always allow a local return, even when the server session already expired.
    applyImpersonation(actor, null);
    try { await adminRequest(actor, '/impersonation/stop', { token: previous.token }, { administrator: true }); }
    catch { setConnectionNotice('חזרתם לחשבון הניהול. לא התקבל אישור לסיום החיבור הזמני בשרת; תוקפו מוגבל לשעה.'); }
  };

  useEffect(() => {
    const expired = () => {
      if (administrator.current && session.current) {
        applyImpersonation(administrator.current, null);
        setConnectionNotice('ההתחזות הסתיימה. חזרתם לחשבון הניהול.');
      }
    };
    window.addEventListener('qc-impersonation-expired', expired);
    const timer = impersonation ? window.setTimeout(expired, Math.max(0, impersonation.expiresAt - Date.now())) : undefined;
    return () => { window.removeEventListener('qc-impersonation-expired', expired); window.clearTimeout(timer); };
  }, [impersonation]);

  useEffect(() => {
    const revoked = async (event: Event) => {
      if (isDevAuthBypass) return;
      const uid = (event as CustomEvent).detail?.uid;
      const epoch = (event as CustomEvent).detail?.epoch ?? apiAuthEpoch();
      const { auth } = await import('../firebase');
      if (apiUserUid() !== uid || epoch !== apiAuthEpoch()) return;
      setConnectionNotice('החיבור במכשיר הזה נותק. יש להתחבר מחדש כדי להמשיך.');
      setUser(null);
      await signOut(auth);
    };
    const listener = (event: Event) => { void revoked(event).catch(() => {}); };
    window.addEventListener('qc-connection-revoked', listener);
    return () => window.removeEventListener('qc-connection-revoked', listener);
  }, []);

  useEffect(() => {
    if (isDevAuthBypass) {
      setUser(createDevAuthUser());
      setLoading(false);
      return;
    }

    let cancelled = false;
    let unsubscribe = () => {};

    void import("../firebase").then(({ auth }) => {
      if (cancelled) return;
      unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
        administrator.current = firebaseUser;
        session.current = null;
        setImpersonation(null);
        setUser(firebaseUser);
        const token = savedToken();
        if (!firebaseUser || !token) {
          saveToken(null); setLoading(false);
          if (firebaseUser) void syncUser(firebaseUser);
          return;
        }
        setLoading(true);
        void adminRequest<Impersonation>(firebaseUser, '/impersonation/session', { token }, { administrator: true }).then(next => {
          if (!cancelled && administrator.current === firebaseUser) applyImpersonation(firebaseUser, next);
        }).catch(() => {
          if (!cancelled && administrator.current === firebaseUser) {
            saveToken(null); setConnectionNotice('ההתחזות הסתיימה. חזרתם לחשבון הניהול.');
          }
        }).finally(() => { if (!cancelled && administrator.current === firebaseUser) setLoading(false); });
      });
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const handleSignIn = async () => {
    setConnectionNotice(null);
    if (isDevAuthBypass) {
      setUser(createDevAuthUser());
      return;
    }

    setLoading(true);
    try {
      const { auth } = await import("../firebase");
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      const credential = await signInWithPopup(auth, provider);
      setUser(credential.user);
      await syncUser(credential.user);
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    if (session.current) { await handleStopImpersonation(); return; }
    if (isDevAuthBypass) {
      setUser(null);
      return;
    }
    const { auth } = await import("../firebase");
    const response = await apiFetch(`${(import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')}/api/connections/logout`, { method: 'POST' });
    if (!response.ok && response.status !== 401) throw new Error('לא ניתן לנתק את החיבור כרגע. נסו שוב.');
    await signOut(auth);
  };

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, isDevBypass: isDevAuthBypass, connectionNotice, signIn: handleSignIn, signOut: handleSignOut,
      impersonation, startImpersonation: handleStartImpersonation, stopImpersonation: handleStopImpersonation }),
    [user, loading, connectionNotice, impersonation],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
